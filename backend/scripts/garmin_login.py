"""Connect your Garmin account to the app. Run on your PC:

    uv run python scripts/garmin_login.py --api https://<your-api-url>

It logs into Garmin here (email, password, MFA code), then sends only the
resulting session tokens to the API. Your Garmin password never leaves this PC.
Run it again if the app says Garmin needs reconnecting.
"""

import argparse
from getpass import getpass

import httpx
from garminconnect import Garmin


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--api", default="http://localhost:8000", help="API base URL")
    args = parser.parse_args()
    api = args.api.rstrip("/")

    email = input("Garmin email: ")
    password = getpass("Garmin password: ")
    garmin = Garmin(email, password, prompt_mfa=lambda: input("Garmin MFA code: "))
    garmin.login()
    print(f"Logged into Garmin as {garmin.get_full_name()}")
    tokens = garmin.client.dumps()

    # Long timeout: the first request may wait for the database to wake up.
    with httpx.Client(base_url=api, timeout=180) as http:
        r = http.post("/api/auth/login", json={"password": getpass("App password: ")})
        r.raise_for_status()
        headers = {"Authorization": f"Bearer {r.json()['token']}"}
        print("Uploading tokens (the database may take up to a minute to wake up)...")
        http.put("/api/garmin/tokens", json={"tokens": tokens}, headers=headers).raise_for_status()
    print("Garmin connected. Click Refresh in the app to import your activities.")


if __name__ == "__main__":
    main()
