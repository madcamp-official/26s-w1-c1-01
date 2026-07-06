import time
import random
import logging
from datetime import datetime
from config import DESTINATIONS, get_search_dates
from scraper import scrape_lowest_price
from storage import init_db, save_price, get_recent_prices

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def main():
    logging.info("Starting daily flight scraper...")
    init_db()
    
    scrape_date = datetime.now().strftime("%Y-%m-%d")
    depart_date, return_date = get_search_dates()
    
    success_count = 0
    fail_count = 0
    
    for idx, dest in enumerate(DESTINATIONS):
        logging.info(f"[{idx+1}/{len(DESTINATIONS)}] Processing ICN -> {dest}")
        
        price, url = scrape_lowest_price("icn", dest, depart_date, return_date)
        
        if price:
            save_price(scrape_date, "ICN", dest, depart_date, return_date, price, "Multiple", url)
            success_count += 1
            logging.info(f"Saved: ICN -> {dest} : {price} ₩")
        else:
            save_price(scrape_date, "ICN", dest, depart_date, return_date, -1, "N/A", url)
            fail_count += 1
            logging.warning(f"Failed to find price for {dest}")
            
        # 봇 탐지 우회를 위한 랜덤 딜레이 (3 ~ 10초)
        delay = random.uniform(3, 10)
        time.sleep(delay)
        
    logging.info(f"Scraping completed. Success: {success_count}, Fail: {fail_count}")

    # 최저가 상위 5개 출력
    df = get_recent_prices()
    if not df.empty:
        valid_prices = df[df['lowest_price'] > 0]
        top_5 = valid_prices.sort_values(by='lowest_price').head(5)
        print("\n=== Top 5 Cheapest Destinations ===")
        for index, row in top_5.iterrows():
            print(f"{row['destination']}: {row['lowest_price']:,} ₩ ({row['url']})")

if __name__ == "__main__":
    main()
