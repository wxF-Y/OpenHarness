"""Code identifier splitting for FTS5 tokens_split column."""
import pytest
from services.rag.chunkers.util import split_code_tokens


@pytest.mark.parametrize(
    "input_text,expected_tokens",
    [
        ("validateUser", ["validate", "User", "validateUser"]),
        ("check_password", ["check", "password", "check_password"]),
        ("kebab-case", ["kebab", "case", "kebab-case"]),
        ("SCREAMING_SNAKE", ["SCREAMING", "SNAKE", "SCREAMING_SNAKE"]),
        ("HTTPSConnection", ["HTTPS", "Connection", "HTTPSConnection"]),
        ("user2FAToken", ["user", "FAToken", "user2FAToken"]),
        ("a_b c-d eF", ["a", "b", "c", "d", "e", "F", "a_b", "c-d", "eF"]),
        ("", []),
    ],
)
def test_split_code_tokens(input_text, expected_tokens):
    result = split_code_tokens(input_text).split()
    for tok in expected_tokens:
        assert tok in result, f"expected {tok!r} in {result}"
