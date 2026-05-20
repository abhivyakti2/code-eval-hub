"""
Adapts transcript_loader.py for GitHub repositories.
We fetch all code files from a GitHub repo and return them
as a list of (path, content) tuples — the equivalent of
document chunks at the source level.
"""

import asyncio
import base64

import httpx

from config import GITHUB_TOKEN

HEADERS = {
    "Authorization": f"Bearer {GITHUB_TOKEN}",
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}

DIFF_HEADERS = {
    **HEADERS,
    "Accept": "application/vnd.github.v3.diff",
}

MAX_FILE_SIZE = 500_000  # 500 KB — skip very large files

# File extensions to include (source code only)
INCLUDE_EXTENSIONS = {
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".go",
    ".java",
    ".rs",
    ".cpp",
    ".c",
    ".cs",
    ".rb",
    ".php",
    ".swift",
    ".kt",
    ".md",
    ".yaml",
    ".yml",
    ".json",
    ".toml",
    ".env.example",
    ".sh",
    ".html", ".css", ".scss", ".sass", ".vue", ".svelte",
}


def fetch_file_tree(owner: str, repo: str, sha: str = "HEAD") -> list[dict]:
    """Return list of file metadata dicts from the repo tree."""
    url = (
        f"https://api.github.com/repos/{owner}/{repo}/git/trees/{sha}?recursive=1"
    )
    r = httpx.get(url, headers=HEADERS, timeout=30)
    # print(f"[DEBUG] tree fetch status: {r.status_code} for {owner}/{repo}")
    # print(f"[DEBUG] tree response: {r.text[:300]}")  # first 300 chars
    r.raise_for_status()
    data = r.json()
    tree = data.get("tree")
    if tree is None:
        raise ValueError(
            f"Unexpected GitHub API response for {owner}/{repo}: missing 'tree' key"
        )

    return [
        item
        for item in data.get("tree", [])
        if item["type"] == "blob"
        and item.get("size", 0) < MAX_FILE_SIZE
        and any(item["path"].endswith(ext) for ext in INCLUDE_EXTENSIONS)
    ]


def fetch_file_content(owner: str, repo: str, path: str) -> str:
    """Fetch and decode a single file's content."""
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}"
    r = httpx.get(url, headers=HEADERS, timeout=30)
    if r.status_code != 200:
        return ""
    data = r.json()
    if data.get("encoding") == "base64":
        return base64.b64decode(data["content"]).decode("utf-8", errors="replace")
    return data.get("content", "")


async def _fetch_file_content_async(
    client: httpx.AsyncClient, owner: str, repo: str, path: str
) -> str:
    url = f"https://api.github.com/repos/{owner}/{repo}/contents/{path}"
    r = await client.get(url, headers=HEADERS, timeout=30)
    if r.status_code != 200:
        return ""
    data = r.json()
    if data.get("encoding") == "base64":
        return base64.b64decode(data["content"]).decode("utf-8", errors="replace")
    return data.get("content", "")


def fetch_commits_by_contributor(
    owner: str, repo: str, login: str, since: str | None = None
) -> list[dict]:
    """Fetch commit messages for a contributor — equivalent of transcript for that person."""
    url = f"https://api.github.com/repos/{owner}/{repo}/commits"
    # PERFORMANCE: only recent commits for contributor-level context.
    params = {"author": login, "per_page": 30}
    if since:
        params["since"] = since

    r = httpx.get(url, headers=HEADERS, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def fetch_commit_diff(owner: str, repo: str, sha: str) -> str:
    """Fetch raw unified diff for a single commit."""
    url = f"https://api.github.com/repos/{owner}/{repo}/commits/{sha}"
    r = httpx.get(url, headers=DIFF_HEADERS, timeout=30)
    if r.status_code != 200:
        return ""
    return r.text


def build_repo_text(owner: str, repo: str) -> str:
    """Build a single concatenated text from all source files."""
    files = fetch_file_tree(owner, repo)

    async def _build() -> str:
        parts: list[str] = []
        async with httpx.AsyncClient() as client:
            tasks = [
                _fetch_file_content_async(client, owner, repo, f["path"])
                for f in files
            ]
            results = await asyncio.gather(*tasks)
            for f, content in zip(files, results):
                if content and content.strip():
                    parts.append(f"### FILE: {f['path']}\n\n{content}\n")
        return "\n\n".join(parts)

    return asyncio.run(_build())


# Contributor text cache (TTL) to avoid re-fetching commits/diffs across repeated requests.
_contributor_text_cache: dict[str, tuple[str, float]] = {}
_CONTRIBUTOR_CACHE_TTL_SECONDS = 60 * 60  # 1 hour


def _contrib_cache_key(
    owner: str, repo: str, login: str, since: str | None
) -> str:
    return f"{owner}:{repo}:{login}:{since or ''}"


def build_contributor_text(
    owner: str, repo: str, login: str, since: str | None = None
) -> str:
    """Build contributor-specific text from their commit diffs (parallel fetch + TTL cache)."""
    import time

    cache_key = _contrib_cache_key(owner, repo, login, since)
    cached = _contributor_text_cache.get(cache_key)
    if cached is not None:
        text, ts = cached
        if (time.time() - ts) < _CONTRIBUTOR_CACHE_TTL_SECONDS:
            return text

    commits = fetch_commits_by_contributor(owner, repo, login, since=since)
    shas = [c.get("sha", "") for c in commits]

    async def _fetch_diff_async(client: httpx.AsyncClient, sha: str) -> str:
        if not sha:
            return ""
        url = f"https://api.github.com/repos/{owner}/{repo}/commits/{sha}"
        r = await client.get(url, headers=DIFF_HEADERS, timeout=30)
        if r.status_code != 200:
            return ""
        return r.text

    async def _build() -> str:
        async with httpx.AsyncClient() as client:
            diffs = await asyncio.gather(*[_fetch_diff_async(client, s) for s in shas])

        lines: list[str] = [
            f"Contributor: {login}", f"Total commits: {len(commits)}", ""]
        for commit, diff, sha in zip(commits, diffs, shas):
            msg = commit.get("commit", {}).get("message", "")
            date = commit.get("commit", {}).get("author", {}).get("date", "")
            if diff:
                diff = diff[:12000]
                lines.append(
                    f"[{date}] {msg}\nSHA: {sha}\nDIFF:\n{diff}\n"
                )
            else:
                lines.append(f"[{date}] {msg}\nSHA: {sha}\n")
        return "\n".join(lines)

    text = asyncio.run(_build())
    _contributor_text_cache[cache_key] = (text, time.time())
    return text


def get_latest_sha(owner: str, repo: str) -> str:
    url = f"https://api.github.com/repos/{owner}/{repo}/commits/HEAD"
    r = httpx.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    return r.json()["sha"]
