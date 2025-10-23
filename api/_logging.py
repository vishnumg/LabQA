import json
import sys


def log(event: str, **kwargs):
    rec = {"event": event, **kwargs}
    sys.stdout.write(json.dumps(rec) + "\n")
    sys.stdout.flush()
