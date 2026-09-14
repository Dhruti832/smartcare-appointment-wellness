import sys
sys.path.insert(0, '../../backend/auth')
from hashing_utils import hash_text


def test_hash_is_deterministic():
    assert hash_text('fluffy') == hash_text('fluffy')


def test_different_text_hashes_differently():
    assert hash_text('fluffy') != hash_text('rex')


def test_caller_controls_normalization():
    # hash_text does not normalize case itself -- callers must do that first
    assert hash_text('fluffy') != hash_text('Fluffy')