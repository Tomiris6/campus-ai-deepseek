import urllib.parse
import os
import time
import random
import logging
from collections import deque # For efficient queue operations

# Import third-party libraries
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException
from webdriver_manager.chrome import ChromeDriverManager
from bs4 import BeautifulSoup, Tag
import psycopg2
from dotenv import load_dotenv

# Load environment variables from a .env file.
# This must be called at the beginning of the script to load configuration.
load_dotenv()

# --- Configuration Variables from .env file ---
# These are loaded from the .env file but have default values for safety.
START_URL = os.getenv('START_URL', "https://www.ktmc.edu.hk/")
MAX_DEPTH = int(os.getenv('MAX_DEPTH', 2))
MIN_DELAY_BETWEEN_PAGES = float(os.getenv('MIN_DELAY_BETWEEN_PAGES', 0.5))
MAX_DELAY_BETWEEN_PAGES = float(os.getenv('MAX_DELAY_BETWEEN_PAGES', 1.5))
DOMAIN = urllib.parse.urlparse(START_URL).netloc
# A list of keywords to skip when crawling to avoid non-content pages.
SKIP_KEYWORDS = os.getenv('SKIP_KEYWORDS', 'login,logout,register,cart,privacy,terms').split(',')

# --- PostgreSQL Configuration Variables from .env file ---
# These variables are essential for connecting to the database.
PG_DB_HOST = os.getenv('DB_HOST', 'localhost')
PG_DB_NAME = os.getenv('DB_NAME', 'webscraper_db')
PG_DB_USER = os.getenv('DB_USER')
PG_DB_PASSWORD = os.getenv('DB_PASSWORD')
PG_DB_PORT = os.getenv('DB_PORT', '5432')

# --- Logging Setup ---
# Configure logging to show informative messages with timestamps.
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Database Setup and Table Creation ---
def create_tables(conn):
    """
    Creates the necessary tables in the PostgreSQL database.
    It checks if tables already exist to prevent errors on re-runs.
    """
    try:
        with conn.cursor() as cursor:
            # Create the 'pages' table to store scraped web page content.
            # The `url` is a PRIMARY KEY to prevent duplicate entries.
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS pages (
                    url TEXT NOT NULL PRIMARY KEY,
                    scraped_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    title TEXT,
                    content TEXT,
                    h1_tags TEXT,
                    h2_tags TEXT,
                    h3_tags TEXT,
                    meta_description TEXT,
                    meta_keywords TEXT
                );
            """)

            # Create a dedicated table for knowledge base embeddings for RAG.
            # This table will store chunks of text and their vector representations.
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS knowledge_base (
                    id SERIAL PRIMARY KEY,
                    content_text TEXT,
                    source_url TEXT,
                    source_table TEXT,
                    source_id TEXT,
                    embedding VECTOR(1536)
                );
            """)

            # Create indexes for faster searches (critical for RAG performance).
            # These indexes help speed up full-text and title searches.
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_pages_title ON pages(title);')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_pages_content ON pages USING gin(to_tsvector(\'english\', content));')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_pages_h2_tags ON pages USING gin(to_tsvector(\'english\', h2_tags));')
            conn.commit()
            logging.info("Database tables and indexes created or verified successfully.")

    except psycopg2.Error as e:
        logging.error(f"Error creating database tables: {e}")
        conn.rollback()

def insert_data(conn, scraped_data):
    """
    Inserts or updates a single scraped page's data into the `pages` table.
    It uses `ON CONFLICT (url) DO UPDATE` to handle re-scraped pages,
    which is an excellent practice.
    """
    try:
        with conn.cursor() as cursor:
            cursor.execute("""
                INSERT INTO pages (url, title, content, h1_tags, h2_tags, h3_tags, meta_description, meta_keywords)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (url) DO UPDATE SET
                    scraped_at = EXCLUDED.scraped_at,
                    title = EXCLUDED.title,
                    content = EXCLUDED.content,
                    h1_tags = EXCLUDED.h1_tags,
                    h2_tags = EXCLUDED.h2_tags,
                    h3_tags = EXCLUDED.h3_tags,
                    meta_description = EXCLUDED.meta_description,
                    meta_keywords = EXCLUDED.meta_keywords;
            """, (
                scraped_data['url'],
                scraped_data['title'],
                scraped_data['content'],
                scraped_data.get('h1_tags', ''),
                scraped_data.get('h2_tags', ''),
                scraped_data.get('h3_tags', ''),
                scraped_data.get('meta_description', ''),
                scraped_data.get('meta_keywords', '')
            ))
            conn.commit()
            logging.info(f"Successfully inserted/updated data for URL: {scraped_data['url']}")
    except psycopg2.Error as e:
        logging.error(f"Error inserting data for {scraped_data['url']}: {e}")
        conn.rollback()

# --- Web Scraping Functions ---
def get_driver():
    """Initializes and returns a Selenium WebDriver with headless options."""
    chrome_options = Options()
    chrome_options.add_argument("--headless") # Runs the browser in the background
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--log-level=3") # Suppress logs
    service = Service(ChromeDriverManager().install())
    return webdriver.Chrome(service=service, options=chrome_options)

def is_valid_url(url, domain, visited):
    """
    Checks if a URL is valid for crawling based on domain, visited status,
    and file extension/protocol filters.
    """
    if not url or url.startswith('mailto:') or url.startswith('tel:') or url.startswith('#'):
        return False
    # Normalize URL to handle trailing slashes consistently
    normalized_url = url.rstrip('/')
    parsed_url = urllib.parse.urlparse(normalized_url)
    if parsed_url.netloc != domain:
        return False
    if normalized_url in visited:
        return False
    if any(keyword in normalized_url.lower() for keyword in SKIP_KEYWORDS + ['.pdf', '.jpg', '.png', '.gif', '.zip']):
        return False
    return True

def crawl_website():
    """
    Main crawling function to scrape a website and save to DB.
    This version uses BeautifulSoup for more reliable link extraction.
    """
    driver = None
    pg_conn = None
    pages_scraped_count = 0
    urls_to_visit = deque([(START_URL, 0)])
    visited_urls = set()

    try:
        # --- Database Connection and Setup ---
        pg_conn = psycopg2.connect(
            host=PG_DB_HOST,
            database=PG_DB_NAME,
            user=PG_DB_USER,
            password=PG_DB_PASSWORD,
            port=PG_DB_PORT
        )
        logging.info("Successfully connected to PostgreSQL database.")
        # create_tables(pg_conn) # You can uncomment this if you need to create the tables again

        # --- WebDriver Initialization ---
        driver = get_driver()
        logging.info("WebDriver initialized.")

        # Main scraping loop
        while urls_to_visit and pages_scraped_count < 100: # Safety limit to prevent infinite crawling
            current_url, current_depth = urls_to_visit.popleft()
            
            # Normalize URL before checking against visited set
            normalized_url = current_url.rstrip('/')

            if not is_valid_url(normalized_url, DOMAIN, visited_urls) or current_depth > MAX_DEPTH:
                continue
            
            # Mark the URL as visited as we are about to scrape it
            visited_urls.add(normalized_url)
            pages_scraped_count += 1
            logging.info(f"Scraping ({pages_scraped_count}/{100}) at Depth {current_depth}: {normalized_url}")

            # Politeness delay
            time.sleep(random.uniform(MIN_DELAY_BETWEEN_PAGES, MAX_DELAY_BETWEEN_PAGES))

            try:
                driver.get(normalized_url)
                # Wait for the body element to be present before scraping
                WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
                
                # Use BeautifulSoup on the page source for more reliable parsing
                soup = BeautifulSoup(driver.page_source, 'html.parser')
                
                # --- Content Extraction and Cleaning ---
                body_content = soup.find('body')
                if body_content:
                    text_content = body_content.get_text(separator=' ', strip=True)
                    cleaned_content = '\n'.join(line.strip() for line in text_content.split('\n') if line.strip())
                else:
                    cleaned_content = ""

                # Extract key tags with robust error handling
                title_tag = soup.title.string.strip() if soup.title and soup.title.string else 'No Title'
                h1_tags = [tag.get_text(strip=True) for tag in soup.find_all('h1')]
                h2_tags = [tag.get_text(strip=True) for tag in soup.find_all('h2')]
                h3_tags = [tag.get_text(strip=True) for tag in soup.find_all('h3')]
                meta_description_tag = soup.find('meta', attrs={'name': 'description'})
                meta_keywords_tag = soup.find('meta', attrs={'name': 'keywords'})

                scraped_data = {
                    'url': normalized_url,
                    'title': title_tag,
                    'content': cleaned_content,
                    'h1_tags': ' '.join(h1_tags),
                    'h2_tags': ' '.join(h2_tags),
                    'h3_tags': ' '.join(h3_tags),
                    'meta_description': meta_description_tag.get('content', '') if isinstance(meta_description_tag, Tag) else '',
                    'meta_keywords': meta_keywords_tag.get('content', '') if isinstance(meta_keywords_tag, Tag) else ''
                }
                
                # Insert the extracted data into the `pages` table
                insert_data(pg_conn, scraped_data)

                # --- Find and add new links to the queue using BeautifulSoup ---
                if current_depth < MAX_DEPTH:
                    for a_tag in soup.find_all('a', href=True):
                        if isinstance(a_tag, Tag):
                            href = a_tag.get('href')
                            full_url = urllib.parse.urljoin(normalized_url, str(href))
                            
                            # Add a new check here to avoid re-adding links that are already in the queue.
                            # This is a small optimization to improve performance.
                            is_already_in_queue = any(url_in_queue.rstrip('/') == full_url.rstrip('/') for url_in_queue, _ in urls_to_visit)
                            
                            if not is_already_in_queue and is_valid_url(full_url, DOMAIN, visited_urls):
                                urls_to_visit.append((full_url, current_depth + 1))
                                logging.debug(f"Added to queue: {full_url} (Depth: {current_depth + 1})")

            except TimeoutException:
                logging.warning(f"Timeout waiting for page to load on {normalized_url}.")
            except Exception as e:
                logging.error(f"Error scraping {normalized_url}: {e}")

    except psycopg2.Error as e:
        logging.critical(f"Database connection failed: {e}")
    except WebDriverException as e:
        logging.critical(f"WebDriver error: {e}")
    except Exception as e:
        logging.critical(f"An unexpected error occurred: {e}")
    finally:
        # --- Finalization: Close all connections and resources ---
        if driver:
            driver.quit()
            logging.info("WebDriver closed.")
        if pg_conn:
            pg_conn.close()
            logging.info("PostgreSQL database connection closed.")
        
        print(f"Total pages scraped and saved: {pages_scraped_count}")

# --- Run the crawler ---
if __name__ == "__main__":
    crawl_website()
