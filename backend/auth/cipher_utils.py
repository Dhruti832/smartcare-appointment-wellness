CIPHER_SHIFT = 3


def caesar_encode(text, shift):
    return _caesar_shift(text, shift)


def caesar_decode(text, shift):
    return _caesar_shift(text, -shift)


def _caesar_shift(text, shift):
    result = []
    for char in text:
        if char.isalpha():
            base = ord('A') if char.isupper() else ord('a')
            result.append(chr((ord(char) - base + shift) % 26 + base))
        else:
            result.append(char)
    return ''.join(result)
