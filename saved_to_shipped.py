"""Compatibility launcher for the original command-line workflow."""
import sys
from saved_to_shipped.core import main

if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ValueError, OSError) as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)
