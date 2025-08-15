import urllib.parse
import os
import time
import random
import logging
from collections import deque  # For efficient queue operations

# Import third-party libraries
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException, NoSuchElementException
from webdriver_manager.chrome import ChromeDriverManager
from bs4 import BeautifulSoup, Tag
import psycopg2
from dotenv import load_dotenv
import gc  # For garbage collection

# Load environment variables from a .env file.
load_dotenv()

# --- Configuration Variables from .env file ---
START_URL = os.getenv('START_URL', "https://www.ktmc.edu.hk/")
MAX_DEPTH = int(os.getenv('MAX_DEPTH', 2))
MIN_DELAY_BETWEEN_PAGES = float(os.getenv('MIN_DELAY_BETWEEN_PAGES', 0.5))
MAX_DELAY_BETWEEN_PAGES = float(os.getenv('MAX_DELAY_BETWEEN_PAGES', 1.5))
DOMAIN = urllib.parse.urlparse(START_URL).netloc
SKIP_KEYWORDS = os.getenv('SKIP_KEYWORDS', 'login,logout,register,cart,privacy,terms').split(',')

# --- Enhanced Configuration Variables ---
DRIVER_RESTART_INTERVAL = int(os.getenv('DRIVER_RESTART_INTERVAL', 50))  # Restart driver every N pages
MAX_RETRIES = int(os.getenv('MAX_RETRIES', 3))  # Maximum retries for failed pages
ENABLE_JAVASCRIPT = os.getenv('ENABLE_JAVASCRIPT', 'true').lower() == 'true'  # Enable JavaScript
PAGE_LIMIT = int(os.getenv('PAGE_LIMIT', 0))  # 0 = no limit, N = limit to N pages

# --- PostgreSQL Configuration Variables from .env file ---
PG_DB_HOST = os.getenv('DB_HOST', 'localhost')
PG_DB_NAME = os.getenv('DB_NAME', 'webscraper_db')
PG_DB_USER = os.getenv('DB_USER')
PG_DB_PASSWORD = os.getenv('DB_PASSWORD')
PG_DB_PORT = os.getenv('DB_PORT', '5432')

# --- Logging Setup ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')


# --- Enhanced Database Setup and Table Creation ---
def create_tables(conn):
    """
    Creates the necessary tables in the PostgreSQL database with improved schema.
    """
    try:
        with conn.cursor() as cursor:
            # Enhanced 'pages' table with better structure
            # In the create_tables function
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS pages (
                    id SERIAL PRIMARY KEY,
                    url TEXT NOT NULL UNIQUE,
                    scraped_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    title TEXT,
                    content TEXT,
                    h1_tags TEXT,
                    h2_tags TEXT,
                    h3_tags TEXT,
                    meta_description TEXT,
                    meta_keywords TEXT,
                    page_depth INTEGER DEFAULT 0,
                    retry_count INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'success'
                );
            """)


            # Knowledge base table for RAG embeddings (Aadib's approach)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS knowledge_base (
                    id SERIAL PRIMARY KEY,
                    content_text TEXT,
                    source_url TEXT,
                    source_table TEXT,
                    source_id TEXT,
                    embedding VECTOR(1536),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            """)

            # Enhanced indexes for better performance
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_pages_title ON pages(title);')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_pages_content ON pages USING gin(to_tsvector(\'english\', content));')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_pages_h2_tags ON pages USING gin(to_tsvector(\'english\', h2_tags));')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_pages_depth ON pages(page_depth);')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_pages_status ON pages(status);')
            cursor.execute('CREATE INDEX IF NOT EXISTS idx_pages_scraped_at ON pages(scraped_at);')
            
            conn.commit()
            logging.info("Enhanced database tables and indexes created successfully.")

    except psycopg2.Error as e:
        logging.error(f"Error creating database tables: {e}")
        conn.rollback()


def insert_data(conn, scraped_data):
    """
    Enhanced data insertion with better error handling and status tracking.
    """
    try:
        with conn.cursor() as cursor:
            cursor.execute("""
    INSERT INTO pages (url, title, content, h1_tags, h2_tags, h3_tags, 
                     meta_description, meta_keywords, page_depth, retry_count, status)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (url) DO UPDATE SET
        scraped_at = CURRENT_TIMESTAMP,
        title = EXCLUDED.title,
        content = EXCLUDED.content,
        h1_tags = EXCLUDED.h1_tags,
        h2_tags = EXCLUDED.h2_tags,
        h3_tags = EXCLUDED.h3_tags,
        meta_description = EXCLUDED.meta_description,
        meta_keywords = EXCLUDED.meta_keywords,
        page_depth = EXCLUDED.page_depth,
        retry_count = EXCLUDED.retry_count,
        status = EXCLUDED.status;
""", (
    scraped_data['url'],
    scraped_data['title'],
    scraped_data['content'],
    scraped_data.get('h1_tags', ''),
    scraped_data.get('h2_tags', ''),
    scraped_data.get('h3_tags', ''),
    scraped_data.get('meta_description', ''),
    scraped_data.get('meta_keywords', ''),
    scraped_data.get('page_depth', 0),
    scraped_data.get('retry_count', 0),  # ADD THIS LINE
    scraped_data.get('status', 'success')
))

            conn.commit()
            logging.info(f"Successfully inserted/updated data for URL: {scraped_data['url']}")
    except psycopg2.Error as e:
        logging.error(f"Error inserting data for {scraped_data['url']}: {e}")
        conn.rollback()


# --- Enhanced Web Scraping Functions ---
def get_driver():
    """Enhanced WebDriver with JavaScript support and memory optimization."""
    chrome_options = Options()
    chrome_options.add_argument("--headless")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--disable-extensions")
    chrome_options.add_argument("--disable-plugins")
    chrome_options.add_argument("--disable-images")
    chrome_options.add_argument("--disable-animations")
    chrome_options.add_argument("--disable-web-security")
    chrome_options.add_argument("--disable-features=VizDisplayCompositor")
    chrome_options.add_argument("--memory-pressure-off")
    chrome_options.add_argument("--max_old_space_size=4096")
    chrome_options.add_argument("--log-level=3")
    
    # JavaScript configuration
    if ENABLE_JAVASCRIPT:
        # Enable JavaScript but optimize performance
        prefs = {
            "profile.managed_default_content_settings.images": 2,
            "profile.default_content_settings.popups": 0,
            "profile.managed_default_content_settings.stylesheet": 2,
            "profile.default_content_setting_values.notifications": 2,
            "profile.default_content_setting_values.automatic_downloads": 2,
            "profile.default_content_setting_values.plugins": 2,
        }
    else:
        # Disable JavaScript for faster scraping
        chrome_options.add_argument("--disable-javascript")
        prefs = {
            "profile.managed_default_content_settings.images": 2,
            "profile.managed_default_content_settings.javascript": 2,
            "profile.default_content_settings.popups": 0,
            "profile.managed_default_content_settings.stylesheet": 2,
        }
    
    chrome_options.add_experimental_option("prefs", prefs)
    chrome_options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
    
    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=chrome_options)
    driver.set_page_load_timeout(30)
    driver.implicitly_wait(10)
    return driver


def restart_driver(driver):
    """Safely restarts the WebDriver to free memory."""
    try:
        if driver:
            driver.quit()
            logging.info("Driver restarted to free memory.")
    except Exception as e:
        logging.warning(f"Error while restarting driver: {e}")
    
    # Force garbage collection
    gc.collect()
    return get_driver()


def is_valid_url(url, domain, visited):
    """Enhanced URL validation with better filtering."""
    if not url or url.startswith(('mailto:', 'tel:', '#', 'javascript:')):
        return False
    
    normalized_url = url.rstrip('/')
    parsed_url = urllib.parse.urlparse(normalized_url)
    
    if parsed_url.netloc != domain:
        return False
    
    if normalized_url in visited:
        return False
    
    # Enhanced skip patterns
    skip_extensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.zip', '.rar', 
                      '.mp3', '.mp4', '.avi', '.mov', '.css', '.js', '.xml', '.json', '.txt']
    
    if any(normalized_url.lower().endswith(ext) for ext in skip_extensions):
        return False
    
    if any(keyword in normalized_url.lower() for keyword in SKIP_KEYWORDS):
        return False
    
    return True


def scrape_page_with_retry(driver, url, depth, conn, retry_count=0):
    """
    Enhanced page scraping with retry logic and JavaScript support.
    """
    try:
        driver.get(url)
        
        # Wait for JavaScript content if enabled
        if ENABLE_JAVASCRIPT:
            time.sleep(2)  # Wait for dynamic content
            WebDriverWait(driver, 5).until(
                lambda d: d.execute_script("return document.readyState") == "complete"
            )
        
        # Wait for body element
        WebDriverWait(driver, 10).until(EC.presence_of_element_located((By.TAG_NAME, "body")))
        
        # Use BeautifulSoup for reliable parsing
        soup = BeautifulSoup(driver.page_source, 'html.parser')
        
        # Enhanced content extraction
        body_content = soup.find('body')
        if body_content:
            text_content = body_content.get_text(separator=' ', strip=True)
            cleaned_content = '\n'.join(line.strip() for line in text_content.split('\n') if line.strip())
        else:
            cleaned_content = ""
        
        # Extract key tags with robust error handling
        title_tag = soup.title.string.strip() if soup.title and soup.title.string else 'No Title'
        h1_tags = [tag.get_text(strip=True) for tag in soup.find_all('h1') if tag.get_text(strip=True)]
        h2_tags = [tag.get_text(strip=True) for tag in soup.find_all('h2') if tag.get_text(strip=True)]
        h3_tags = [tag.get_text(strip=True) for tag in soup.find_all('h3') if tag.get_text(strip=True)]
        
        meta_description_tag = soup.find('meta', attrs={'name': 'description'})
        meta_keywords_tag = soup.find('meta', attrs={'name': 'keywords'})
        
        scraped_data = {
            'url': url.rstrip('/'),
            'title': title_tag,
            'content': cleaned_content,
            'h1_tags': ' | '.join(h1_tags),
            'h2_tags': ' | '.join(h2_tags),
            'h3_tags': ' | '.join(h3_tags),
            'meta_description': meta_description_tag.get('content', '') if isinstance(meta_description_tag, Tag) else '',
            'meta_keywords': meta_keywords_tag.get('content', '') if isinstance(meta_keywords_tag, Tag) else '',
            'page_depth': depth,
            'retry_count': retry_count,
            'status': 'success'
        }
        
        # Insert data
        insert_data(conn, scraped_data)
        return scraped_data, True
        
    except TimeoutException:
        logging.warning(f"TimeoutException on {url} (Attempt {retry_count + 1}/{MAX_RETRIES}).")
        if retry_count < MAX_RETRIES:
            logging.info(f"Retrying {url} (attempt {retry_count + 1}/{MAX_RETRIES})")
            time.sleep(2)
            return scrape_page_with_retry(driver, url, depth, conn, retry_count + 1)
        else:
            # Mark as failed in database
            failed_data = {
                'url': url.rstrip('/'),
                'title': 'Failed to load',
                'content': '',
                'h1_tags': '',
                'h2_tags': '',
                'h3_tags': '',
                'meta_description': '',
                'meta_keywords': '',
                'page_depth': depth,
                'status': 'failed'
            }
            insert_data(conn, failed_data)
            return failed_data, False
            
    except Exception as e:
        logging.error(f"Error scraping {url} (Attempt {retry_count + 1}/{MAX_RETRIES}): {type(e).__name__} - {e}")
        if retry_count < MAX_RETRIES:
            logging.info(f"Retrying {url} (attempt {retry_count + 1}/{MAX_RETRIES})")
            time.sleep(2)
            return scrape_page_with_retry(driver, url, depth, conn, retry_count + 1)
        else:
            failed_data = {
                'url': url.rstrip('/'),
                'title': 'Error occurred',
                'content': '',
                'h1_tags': '',
                'h2_tags': '',
                'h3_tags': '',
                'meta_description': '',
                'meta_keywords': '',
                'page_depth': depth,
                'status': 'error'
            }
            insert_data(conn, failed_data)
            return failed_data, False



def crawl_website():
    """
    Enhanced crawling function with unlimited pages, memory management, and JavaScript support.
    """
    driver = None
    pg_conn = None
    pages_scraped_count = 0
    urls_to_visit = deque([(START_URL, 0)])
    visited_urls = set()
    overall_start_time = time.time()

    try:
        # Database connection and setup
        pg_conn = psycopg2.connect(
            host=PG_DB_HOST,
            database=PG_DB_NAME,
            user=PG_DB_USER,
            password=PG_DB_PASSWORD,
            port=PG_DB_PORT
        )
        logging.info("Successfully connected to PostgreSQL database.")

        with pg_conn.cursor() as cursor:
            cursor.execute('TRUNCATE TABLE pages;')
            pg_conn.commit()
        logging.info("Cleared pages table before scraping.")

        create_tables(pg_conn)

        # --- NEW --- Configuration summary at startup
        print("\n--- Scraping Configuration ---")
        print(f"Start URL          : {START_URL}")
        print(f"Domain             : {DOMAIN}")
        print(f"Max Depth          : {MAX_DEPTH}")
        print(f"Page Limit         : {'None' if PAGE_LIMIT == 0 else PAGE_LIMIT}")
        print(f"JavaScript Enabled : {ENABLE_JAVASCRIPT}")
        print("----------------------------\n")

        # Initialize WebDriver
        driver = get_driver()
        logging.info(f"WebDriver initialized with JavaScript {'enabled' if ENABLE_JAVASCRIPT else 'disabled'}.")

        # Main scraping loop
        while urls_to_visit:
            # Check page limit
            if PAGE_LIMIT > 0 and pages_scraped_count >= PAGE_LIMIT:
                logging.info(f"Reached page limit of {PAGE_LIMIT}. Stopping.")
                break
            
            current_url, current_depth = urls_to_visit.popleft()
            normalized_url = current_url.rstrip('/')

            if not is_valid_url(normalized_url, DOMAIN, visited_urls) or current_depth > MAX_DEPTH:
                continue

            visited_urls.add(normalized_url)
            pages_scraped_count += 1
            
            # Restart driver periodically to prevent memory leaks
            if pages_scraped_count > 0 and pages_scraped_count % DRIVER_RESTART_INTERVAL == 0:
                logging.info(f"Restarting driver after {pages_scraped_count} pages to prevent memory leaks")
                driver = restart_driver(driver)
                if not driver:
                    logging.critical("Failed to restart driver. Exiting.")
                    break

            logging.info(f"Scraping ({pages_scraped_count}) | Queue: {len(urls_to_visit)} | Depth: {current_depth} | URL: {normalized_url}")


            # Politeness delay
            time.sleep(random.uniform(MIN_DELAY_BETWEEN_PAGES, MAX_DELAY_BETWEEN_PAGES))

            page_start_time = time.time()

            # Scrape page with retry logic
            scraped_data, success = scrape_page_with_retry(driver, normalized_url, current_depth, pg_conn)

            if success:
                elapsed_time = time.time() - page_start_time
                print("\n=== Scraped Page #{} ===".format(pages_scraped_count))
                print("URL          : {}".format(scraped_data['url']))
                print("Title        : {}".format(scraped_data['title']))
                print("H1 Tags      : {}".format(scraped_data['h1_tags'] or 'None'))
                print("H2 Tags      : {}".format(scraped_data['h2_tags'] or 'None'))
                print("H3 Tags      : {}".format(scraped_data['h3_tags'] or 'None'))
                meta_desc_preview = (scraped_data['meta_description'][:80] + '...') if len(scraped_data['meta_description']) > 80 else scraped_data['meta_description']
                print("Meta Desc   : {}".format(meta_desc_preview or 'None'))
                content_preview = (scraped_data['content'][:200] + '...') if len(scraped_data['content']) > 200 else scraped_data['content']
                print("Content     :\n{}".format(content_preview or 'No content'))
                print(f"Content Size  : {len(scraped_data['content'])} characters")
                print("Page Time   : {:.2f} seconds".format(elapsed_time))
                print("Status      : {}".format(scraped_data['status']))
                print("Page Depth  : {}".format(scraped_data['page_depth']))
                print("Retry Count : {}".format(scraped_data.get('retry_count', 0)))
                print("-" * 80)


            # Find and add new links
            if current_depth < MAX_DEPTH and success:
                try:
                    soup = BeautifulSoup(driver.page_source, 'html.parser')
                    for a_tag in soup.find_all('a', href=True):
                        if isinstance(a_tag, Tag):
                            href = a_tag.get('href')
                            full_url = urllib.parse.urljoin(normalized_url, str(href))
                            
                            # Avoid re-adding links
                            is_already_in_queue = any(url_in_queue.rstrip('/') == full_url.rstrip('/') for url_in_queue, _ in urls_to_visit)
                            
                            if not is_already_in_queue and is_valid_url(full_url, DOMAIN, visited_urls):
                                urls_to_visit.append((full_url, current_depth + 1))
                                logging.debug(f"Added to queue: {full_url} (Depth: {current_depth + 1})")
                except Exception as e:
                    logging.error(f"Error finding links on {normalized_url}: {e}")

    except psycopg2.Error as e:
        logging.critical(f"Database connection failed: {e}")
    except WebDriverException as e:
        logging.critical(f"WebDriver error: {e}")
    except Exception as e:
        logging.critical(f"An unexpected error occurred: {e}")
    finally:
        # Finalization
        if driver:
            driver.quit()
            logging.info("WebDriver closed.")
        if pg_conn:
            pg_conn.close()
            logging.info("PostgreSQL database connection closed.")

        total_elapsed = time.time() - overall_start_time
        print(f"\n=== CRAWLING COMPLETED ===")
        print(f"Total pages scraped: {pages_scraped_count}")
        print(f"Total scraping time: {total_elapsed:.2f} seconds")
        print(f"Average time per page: {total_elapsed/pages_scraped_count:.2f} seconds" if pages_scraped_count > 0 else "No pages scraped")


# --- Run the enhanced crawler ---
if __name__ == "__main__":
    crawl_website() 