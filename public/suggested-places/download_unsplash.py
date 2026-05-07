#!/usr/bin/env python3
"""
Download landscape images from Unsplash for each place.
Requires: requests library (pip install requests)
"""
import requests
import time
import os
from pathlib import Path

# Place data (id, search term)
PLACES = [
    ("times-square", "Times Square New York"),
    ("granville-island", "Granville Island Vancouver"),
    ("colosseum", "The Colosseum Rome"),
    ("shibuya", "Shibuya Crossing Tokyo"),
    ("borough-market", "Borough Market London"),
    ("boqueria", "La Boqueria Barcelona"),
    ("french-quarter", "French Quarter New Orleans"),
    ("montmartre", "Montmartre Paris"),
    ("haight", "Haight-Ashbury San Francisco"),
    ("gamla-stan", "Gamla Stan Stockholm"),
    ("deira-spice", "Deira Spice Souk Dubai"),
    ("petit-champlain", "Quartier Petit Champlain Quebec"),
    ("fitzroy", "Fitzroy Melbourne"),
    ("caminito", "Caminito Buenos Aires"),
    ("fez-medina", "Medina of Fez Morocco"),
    ("innere-stadt", "Innere Stadt Vienna"),
    ("nakameguro", "Nakameguro Tokyo"),
    ("notting-hill", "Notting Hill London"),
    ("pike-place", "Pike Place Market Seattle"),
    ("trastevere", "Trastevere Rome"),
]

OUTPUT_DIR = Path(__file__).parent

def download_images():
    """Download landscape images from Unsplash for each place."""

    for place_id, search_term in PLACES:
        try:
            print(f"Fetching {place_id}...", end=" ", flush=True)

            # Unsplash API endpoint for random photos
            url = "https://api.unsplash.com/photos/random"
            params = {
                "query": search_term,
                "orientation": "landscape",
                "client_id": "HA9SYbh_6UMWFZyrRobbFczMmBxLqoNxamdDgLkj4Xk"  # Get from https://unsplash.com/oauth/applications
            }

            # If you don't have a client ID, use the public endpoint (might have rate limits)
            response = requests.get(
                url,
                params=params,
                timeout=10,
                headers={"User-Agent": "Python-ImgDownloader"}
            )
            response.raise_for_status()

            data = response.json()

            # Get the download URL
            download_url = data.get("links", {}).get("download")

            if download_url:
                print("downloading...", end=" ", flush=True)

                # Download the image
                img_response = requests.get(download_url, timeout=10)
                img_response.raise_for_status()

                # Save with place ID as filename
                output_path = OUTPUT_DIR / f"{place_id}.jpg"
                with open(output_path, "wb") as f:
                    f.write(img_response.content)

                size_kb = len(img_response.content) / 1024
                print(f"✓ saved ({size_kb:.0f}KB)")
            else:
                print("✗ no download URL found")

            time.sleep(0.5)  # Rate limiting

        except Exception as e:
            print(f"✗ error: {str(e)}")

if __name__ == "__main__":
    print(f"Downloading images to: {OUTPUT_DIR}\n")
    download_images()
    print("\nDone!")
