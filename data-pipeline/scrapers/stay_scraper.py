import sqlite3
import datetime
from hotel_config import HOTEL_CITIES, get_hotel_dates
from hotel_scraper import scrape_lowest_hotel_price

def init_db():
    conn = sqlite3.connect('hotels.db')
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS lowest_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            city TEXT,
            checkin TEXT,
            checkout TEXT,
            price INTEGER,
            url TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    return conn

def main():
    conn = init_db()
    c = conn.cursor()
    
    checkin, checkout = get_hotel_dates()
    print(f"Scraping hotel prices for {checkin} to {checkout}")
    
    for city in HOTEL_CITIES:
        price, url = scrape_lowest_hotel_price(city, checkin, checkout)
        if price is not None:
            c.execute('''
                INSERT INTO lowest_prices (city, checkin, checkout, price, url)
                VALUES (?, ?, ?, ?, ?)
            ''', (city, checkin, checkout, price, url))
            conn.commit()
            print(f"Saved {city}: {price}원")
        else:
            print(f"Failed to scrape {city}")
            
    conn.close()
    print("Finished hotel scraping.")

if __name__ == "__main__":
    main()
