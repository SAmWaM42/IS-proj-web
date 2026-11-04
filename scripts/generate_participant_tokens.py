#!/usr/bin/env python3
"""Generate participant bearer tokens and the matching Vercel digest map.

Set SEED to the exact server-side secret configured in Vercel:
    SEED='...' python3 scripts/generate_participant_tokens.py

Keep the output private. Give each participant only their own raw token.
"""
import argparse
import hashlib
import hmac
import json
import os
import secrets
import sys


def digest_token(seed: bytes, participant_number: int, token: str) -> str:
    message = (
        f"animal-agent-participant-token:v1:{participant_number}:{token}"
    ).encode("utf-8")
    return hmac.new(seed, message, hashlib.sha256).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=20,
                        help="number of sequential participant IDs (default: 20)")
    parser.add_argument("--first", type=int, default=1,
                        help="first participant ID (default: 1)")
    args = parser.parse_args()

    seed_value = os.environ.get("SEED")
    if not seed_value:
        parser.error("SEED environment variable is required")
    if args.first < 1 or args.count < 1 or args.first + args.count - 1 > 9999:
        parser.error("participant range must be within 1..9999")

    seed = seed_value.encode("utf-8")
    participant_credentials = {}
    digest_map = {}

    for participant_number in range(args.first, args.first + args.count):
        token = secrets.token_urlsafe(32)
        participant_credentials[str(participant_number)] = token
        digest_map[str(participant_number)] = digest_token(
            seed, participant_number, token
        )

    print("PRIVATE PARTICIPANT CREDENTIALS (distribute one token per participant):")
    print(json.dumps(participant_credentials, indent=2))
    print()
    print("VERCEL PARTICIPANT_TOKENS VALUE (store only in Vercel):")
    print(json.dumps(digest_map, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
