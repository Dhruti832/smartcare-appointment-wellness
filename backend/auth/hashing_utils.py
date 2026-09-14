import hashlib


def hash_text(normalized_text):
    """Caller is responsible for case/whitespace normalization first, since
    security answers and cipher answers normalize differently (lower vs upper)."""
    return hashlib.sha256(normalized_text.encode()).hexdigest()