"""Import adapters for saved content from multiple platforms.

Each adapter emits ImportedSave records and never performs network requests.
"""

from .base import ImportedSave
from .registry import ADAPTERS, read_source

__all__ = ["ImportedSave", "ADAPTERS", "read_source"]
