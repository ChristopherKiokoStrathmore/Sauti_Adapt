"""Open or close a warm GPU window for a test session.

  python warm.py on        keep one GPU container loaded for 10 hours (default)
  python warm.py on 6      ... or for any number of hours up to 12
  python warm.py off       release it now
  python warm.py status    show the time left

While a window is open the deployed app keeps one L4 container running
(about $0.80/h for the GPU plus a little CPU and memory), so every request
skips the cold start. The scheduled enforce_warm_window function in server.py
releases the GPU when the window ends, even if nobody runs "off".

Run with the Modal profile for the workspace that hosts the app, e.g.
  MODAL_PROFILE=ulla39254 uv run --with modal python warm.py on 8
"""
import sys
import time

import modal

APP_NAME = "sauti-adapt-cdli-gpu"
DEFAULT_HOURS = 10.0   # a test day; about $8 on an L4, about $11 on an A10
MAX_HOURS = 12


def main(argv):
    state = modal.Dict.from_name("sauti-adapt-warm-window", create_if_missing=True)
    command = argv[1] if len(argv) > 1 else "status"
    if command == "on":
        hours = float(argv[2]) if len(argv) > 2 else DEFAULT_HOURS
        if not 0 < hours <= MAX_HOURS:
            sys.exit(f"Hours must be between 0 and {MAX_HOURS}.")
        state["until"] = time.time() + hours * 3600
        modal.Cls.from_name(APP_NAME, "CDLIWhisper")().update_autoscaler(min_containers=1)
        print(f"Warm window open for {hours:g} h, until "
              f"{time.strftime('%Y-%m-%d %H:%M', time.localtime(state['until']))}.")
    elif command == "off":
        state["until"] = 0
        modal.Cls.from_name(APP_NAME, "CDLIWhisper")().update_autoscaler(min_containers=0)
        print("Warm window closed. The GPU container shuts down after 5 idle minutes.")
    elif command == "status":
        left = float(state.get("until", 0) or 0) - time.time()
        print(f"Warm for another {left / 3600:.1f} h." if left > 0 else "No warm window open.")
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
