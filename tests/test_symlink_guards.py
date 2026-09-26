"""Every symlink a test creates must be able to skip instead of erroring.

Creating a symlink on Windows requires SeCreateSymbolicLinkPrivilege, which a
normal account does not hold without Developer Mode. Hosted CI runs elevated,
so an unguarded `Path.symlink_to` / `os.symlink` passes there and fails only
on a contributor's Windows checkout, with `WinError 1314` and no connection to
their change. Five tests in `test_audiocpp_backend.py` plus one each in
`test_exports_api.py` and `test_storage_report.py` shipped exactly that.

`tests/conftest.py` provides the `symlink_or_skip` fixture. This test keeps new
call sites on it — a mechanical rule, so it lives in CI rather than in reviewer
attention.

Guarded means one of: the `symlink_or_skip` fixture, a call inside a `try`
(the module already handles the failure), or a helper that skips on its own.
"""

import ast
from pathlib import Path

TESTS = Path(__file__).resolve().parent

# Helpers that already skip on failure themselves; calls inside them are the
# guard, not a violation.
GUARD_FUNCTIONS = {"_symlink_or_skip", "_make", "symlink_or_skip"}


def _creates_symlink(node: ast.AST) -> bool:
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    if isinstance(func, ast.Attribute):
        if func.attr == "symlink_to":
            return True
        if func.attr == "symlink" and isinstance(func.value, ast.Name) and func.value.id == "os":
            return True
    return False


def _has_skipif(decorators) -> bool:
    for decorator in decorators:
        for node in ast.walk(decorator):
            if isinstance(node, ast.Attribute) and node.attr in ("skipif", "skip"):
                return True
    return False


def _module_is_skippable(tree: ast.Module) -> bool:
    """A module-level `pytestmark = pytest.mark.skipif(...)` guards every test
    in the file, so a symlink call inside one is already conditional."""
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        names = {t.id for t in node.targets if isinstance(t, ast.Name)}
        if "pytestmark" in names and _has_skipif([node.value]):
            return True
    return False


def _calls_a_guard(function: ast.AST) -> bool:
    """The test already ran a skipping helper, so reaching a later raw call
    means the environment demonstrably supports symlinks."""
    for node in ast.walk(function):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in GUARD_FUNCTIONS:
                return True
    return False


def _unguarded(path: Path) -> list:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    if _module_is_skippable(tree):
        return []
    parents = {}
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            parents[child] = parent

    bad = []
    for node in ast.walk(tree):
        if not _creates_symlink(node):
            continue
        cursor = node
        guarded = False
        while cursor in parents:
            cursor = parents[cursor]
            if isinstance(cursor, ast.Try):
                guarded = True
                break
            if isinstance(cursor, (ast.FunctionDef, ast.AsyncFunctionDef)):
                if cursor.name in GUARD_FUNCTIONS or _has_skipif(cursor.decorator_list):
                    guarded = True
                    break
                if cursor.name.startswith("test_") and _calls_a_guard(cursor):
                    guarded = True
                    break
        if not guarded:
            bad.append(node.lineno)
    return bad


def test_no_unguarded_symlink_creation_in_tests():
    offenders = {}
    for path in sorted(TESTS.rglob("test_*.py")):
        if path.name == Path(__file__).name:
            continue
        lines = _unguarded(path)
        if lines:
            offenders[str(path.relative_to(TESTS.parent))] = lines
    assert not offenders, (
        "These tests create a symlink without a way to skip, so they fail with "
        "WinError 1314 on a stock Windows checkout. Take the `symlink_or_skip` "
        f"fixture from tests/conftest.py instead: {offenders}"
    )
