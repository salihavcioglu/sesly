# Changelog

All notable changes to Sesly.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/).
`frontend/package.json` is the maintained app-version source of truth; Python
metadata and the backend fallback mirror it. Archived Tauri manifests stay frozen.

## [Unreleased]

## [1.0.0] — 2026-09-26

Sesly 1.0.0 — the project's first release under its own identity, forked from
its prior codebase with no installed user base to migrate.

**Highlights**

- Full rebrand to Sesly across the app, installers, and the archived Tauri shell — no identifiers from the project's prior name remain
- Sponsor/donation UI and Discord invite links removed
- Product analytics stays off by default and ships with no bundled key
- Security hardening: Host allowlist, CSRF protection, SSRF guard, and a hardened PIN cookie

### Changed

- Renamed the product identity end-to-end — bundle id, package names, and installer branding all read Sesly
- Removed the sponsor/donation UI and all Discord invite links; support routes through GitHub Issues/Discussions only
- Product analytics stays disabled out of the box and ships with no bundled key; it activates only when a build supplies one and the user opts in
- Pointed the desktop updater at the salihavcioglu/sesly release feed

### Security

- Added a Host header allowlist to the local API to reject DNS-rebinding-style requests
- Added CSRF protection to state-changing local API routes
- Added an SSRF guard around outbound fetches the backend performs on a user's behalf
- Fixed a yt-dlp argument-injection vulnerability in the media-download path
- Hardened the PIN cookie's attributes
- Tightened the environment variables the app forwards to spawned processes
