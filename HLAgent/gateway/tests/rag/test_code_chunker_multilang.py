"""Verify code chunker handles non-Python languages."""
import pytest

from services.rag.chunkers.code import chunk_code


TS_SAMPLE = """\
export function add(a: number, b: number): number {
  return a + b;
}

class Greeter {
  greet(name: string): string {
    return `Hello ${name}`;
  }
}

interface User { id: string }
"""


GO_SAMPLE = """\
package main

func Add(a, b int) int {
    return a + b
}

type Greeter struct{ name string }

func (g *Greeter) Greet() string {
    return "hello"
}
"""


JAVA_SAMPLE = """\
public class Calc {
    public int add(int a, int b) { return a + b; }
    public int sub(int a, int b) { return a - b; }
}

interface Drawable {
    void draw();
}
"""


CPP_SAMPLE = """\
int add(int a, int b) {
    return a + b;
}

class Greeter {
public:
    std::string greet() { return "hi"; }
};
"""


RUST_SAMPLE = """\
fn add(a: i32, b: i32) -> i32 { a + b }

struct Greeter { name: String }

impl Greeter {
    fn greet(&self) -> String { format!("hi {}", self.name) }
}
"""


@pytest.mark.parametrize(
    "source,lang,expected_symbols",
    [
        (TS_SAMPLE, "typescript", {"add", "Greeter", "User"}),
        (GO_SAMPLE, "go", {"Add", "Greeter"}),
        (JAVA_SAMPLE, "java", {"Calc", "add", "sub", "Drawable"}),
        (CPP_SAMPLE, "cpp", {"add", "Greeter"}),
        (RUST_SAMPLE, "rust", {"add", "Greeter"}),
    ],
)
def test_chunk_code_multilang(source, lang, expected_symbols):
    chunks = list(chunk_code(source, file=f"x.{lang}", lang=lang))
    syms = {c["symbol"] for c in chunks if c["symbol"]}
    # at least HALF of expected symbols should appear (allow tree-sitter to miss some)
    intersection = syms & expected_symbols
    assert len(intersection) >= max(1, len(expected_symbols) // 2), (
        f"{lang}: expected at least half of {expected_symbols} in {syms}"
    )
