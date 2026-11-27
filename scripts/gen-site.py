#!/usr/bin/env python3
"""Render the repo's markdown into a static documentation site for GitHub Pages.

Usage: python3 scripts/gen-site.py [--out site] [--check]

The source of truth stays the markdown in place — nothing is moved or
rewritten. This script maps the published documents to HTML, builds a
structured sidebar + full-site search index (`search-index.json`), adds
right-hand page TOCs, callouts, copy buttons, responsive tables, and
light/dark theming.

Requires: pip install markdown
"""
from __future__ import annotations

import argparse
import html as html_mod
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

try:
    import markdown
except ImportError:  # reported in main(), so --help still works
    markdown = None

ROOT = Path(__file__).resolve().parent.parent
REPO = "https://github.com/carteakey/alvidaa"
BRANCH = "main"

ROOT_PAGES = ["README.md", "AGENTS.md", "SECURITY.md", "TODO.md"]
SCAN_DIRS = ["docs", "tools"]
SKIP_PARTS = {"fixtures", "node_modules", ".git"}

# Curated documentation pillars. Every other markdown file under docs/ and
# tools/ is still rendered and searchable via Cmd+K so no link ever 404s,
# without cluttering the primary navigation.
CURATED_SECTIONS = [
    (
        "Getting Started",
        True,
        [
            ("Overview", "README.md"),
            ("Tested Models Matrix", "docs/research/TESTED-MODELS.md"),
            ("The Three Lanes", "docs/launcher/LANES.md"),
            ("Security & Disclosure", "SECURITY.md"),
            ("Publication Policy", "docs/DISCLOSURE.md"),
        ],
        [],
    ),
    (
        "Launcher & Native Home",
        True,
        [
            ("External Server Deploy", "docs/launcher/DEPLOY.md"),
            ("Reversible Install (09.60+)", "docs/launcher/ALVIDAA-HOME-INSTALL.md"),
            ("Server URL Migration", "docs/launcher/ALVIDAA-HOME-SERVER-MIGRATION.md"),
            ("On-TV Loopback Bridge", "docs/launcher/BRIDGE_DEPLOY.md"),
            ("Native Home Implementations", "tools/launcher-host/IMPLEMENTATIONS.md"),
            ("Native Alvidaa UI", "tools/launcher-host/NATIVE-ALVIDAA.md"),
            ("Native Variants", "tools/launcher-host/VARIANTS.md"),
            ("Install Verification", "tools/launcher-host/VERIFY-INSTALL.md"),
            ("Home UI Internals", "docs/launcher/HOME-UI-INTERNALS.md"),
            ("Android Launcher Comparison", "docs/launcher/EXISTING-LAUNCHERS.md"),
        ],
        [
            (
                "Operations & Design Specs",
                [
                    ("Deploy Preflight Check", "tools/launcher-host/DEPLOY-CHECK.md"),
                    ("Drift Check", "tools/launcher-host/DRIFT-CHECK.md"),
                    ("Recovery Record", "tools/launcher-host/RECOVERY-RECORD.md"),
                    ("Preview Native Home", "tools/launcher-host/PREVIEW-NATIVE-HOME.md"),
                    ("Native Launcher Spec", "tools/launcher-host/NATIVE-LAUNCHER.md"),
                    ("Startup & Retirement", "tools/launcher-host/NATIVE-STARTUP-RETIREMENT.md"),
                    ("Launcher v2 Roadmap", "docs/launcher/LAUNCHER_V2.md"),
                    ("Free My TV Native Port", "docs/launcher/FREE-MY-TV-NATIVE-PORT.md"),
                    ("Free My TV Web Parity", "docs/launcher/FREE-MY-TV-WEB-PARITY.md"),
                ],
            )
        ],
    ),
    (
        "Root & Research",
        True,
        [
            ("Model Guide Index", "docs/models/README.md"),
            ("Method & Exploit Catalogue", "docs/research/EXPLOITS.md"),
            ("Patched Firmware Playbook", "docs/research/10-patched-firmware-playbook.md"),
            ("Screen Capture", "docs/research/11-screen-capture.md"),
            ("AI Prompt Ladder", "docs/project/HACK-YOUR-OWN.md"),
            ("Model Guide Template", "docs/models/_TEMPLATE.md"),
        ],
        [],
    ),
]

PROJECT_SECTION = (
    "Project & Maintainers",
    False,
    [
        ("The Full Story", "docs/project/STORY.md"),
        ("AI Agent Briefing", "AGENTS.md"),
        ("Roadmap (TODO)", "TODO.md"),
        ("Full Docs Map", "docs/README.md"),
        ("Tools Overview", "tools/README.md"),
        ("Secret & PII Sanitizer", "tools/sanitize/README.md"),
        ("ALSA Audio Probe", "tools/audio/README.md"),
    ],
    [],
)

WIDE_PAGES = {
    "README.md",
    "docs/models/README.md",
    "docs/research/TESTED-MODELS.md",
    "docs/research/EXPLOITS.md",
    "docs/research/10-patched-firmware-playbook.md",
}

ALERT_META = {
    "NOTE": ("Note", "note"),
    "TIP": ("Tip", "tip"),
    "IMPORTANT": ("Important", "important"),
    "WARNING": ("Warning", "warning"),
    "CAUTION": ("Caution", "caution"),
}

CSS = r"""
:root {
  color-scheme: light dark;
  --bg: light-dark(#ffffff, #0b0f14);
  --surface: light-dark(#f6f8fa, #111720);
  --surface-2: light-dark(#eef2f6, #17202c);
  --border: light-dark(#d8dee4, #222c3a);
  --border-strong: light-dark(#bfc7d1, #324054);
  --fg: light-dark(#1f2328, #e6edf3);
  --fg-muted: light-dark(#59636e, #8b98a8);
  --accent: light-dark(#0969da, #58a6ff);
  --accent-bg: light-dark(#ddf4ff, rgba(88, 166, 255, 0.14));
  --ok: light-dark(#1a7f37, #3fb950);
  --warn: light-dark(#9a6700, #d29922);
  --danger: light-dark(#cf222e, #f85149);
  --purple: light-dark(#8250df, #a371f7);
  --code-bg: light-dark(#f3f5f8, #0f141c);
  --inline-code-bg: light-dark(#eff1f3, #1c2430);
  --shadow: light-dark(0 12px 36px rgba(15, 23, 42, 0.14), 0 18px 48px rgba(0, 0, 0, 0.55));
  --topbar-h: 56px;
  --side-w: 280px;
  --toc-w: 224px;
}
:root:has(> head > meta[name="color-scheme"][content="dark"]) { color-scheme: dark; }
:root:has(> head > meta[name="color-scheme"][content="light"]) { color-scheme: light; }

* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: calc(var(--topbar-h) + 20px); }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: 15.5px/1.68 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}

/* Top navigation bar */
.topbar {
  position: sticky; top: 0; z-index: 40;
  height: var(--topbar-h);
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  display: flex; align-items: center; gap: 12px;
  padding: 0 20px;
}
.topbar-brand {
  display: flex; align-items: center; gap: 9px;
  font-weight: 700; font-size: 16.5px; color: var(--fg);
  letter-spacing: -0.01em; white-space: nowrap;
}
.topbar-brand:hover { text-decoration: none; }
.topbar-badge {
  font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 999px;
  background: var(--accent-bg); color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
}
.topbar-nav {
  display: flex; align-items: center; gap: 2px; margin-left: 12px;
}
.topbar-nav a {
  padding: 6px 10px; border-radius: 6px; font-size: 13.5px; font-weight: 500;
  color: var(--fg-muted); white-space: nowrap; position: relative;
}
.topbar-nav a:hover { color: var(--fg); background: var(--surface); text-decoration: none; }
.topbar-nav a[aria-current="page"],
.topbar-nav a[aria-current="true"] {
  color: var(--fg); font-weight: 600; background: var(--surface);
}
.topbar-nav a[aria-current="page"]::after,
.topbar-nav a[aria-current="true"]::after {
  content: ""; position: absolute; left: 10px; right: 10px; bottom: -1px;
  height: 2px; border-radius: 2px; background: var(--accent);
}
.topbar-spacer { flex: 1; }
.search-trigger {
  display: inline-flex; align-items: center; gap: 8px;
  height: 34px; padding: 0 10px 0 11px; min-width: 210px;
  background: var(--surface); color: var(--fg-muted);
  border: 1px solid var(--border); border-radius: 8px;
  font: inherit; font-size: 13px; cursor: pointer; text-align: left;
  transition: border-color 0.15s, color 0.15s;
}
.search-trigger:hover { border-color: var(--border-strong); color: var(--fg); }
.search-trigger kbd {
  margin-left: auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px; padding: 1px 5px; border-radius: 4px;
  background: var(--bg); border: 1px solid var(--border); color: var(--fg-muted);
}
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 8px;
  background: transparent; color: var(--fg-muted);
  border: 1px solid transparent; cursor: pointer;
}
.icon-btn:hover { background: var(--surface); color: var(--fg); border-color: var(--border); text-decoration: none; }
#menu-btn { display: none; }

/* Theme toggle icon branching (no JS needed to stay in sync with OS) */
.icon-sun, .icon-moon { display: none; }
@media (prefers-color-scheme: dark) {
  :root:not(:has(> head > meta[name="color-scheme"][content="light"])) .icon-sun { display: block; }
  :root:has(> head > meta[name="color-scheme"][content="light"]) .icon-moon { display: block; }
}
@media (prefers-color-scheme: light) {
  :root:not(:has(> head > meta[name="color-scheme"][content="dark"])) .icon-moon { display: block; }
  :root:has(> head > meta[name="color-scheme"][content="dark"]) .icon-sun { display: block; }
}

/* Main 3-column shell */
.shell {
  display: grid;
  grid-template-columns: var(--side-w) minmax(0, 1fr) var(--toc-w);
  max-width: 1480px;
  margin: 0 auto;
  min-height: calc(100vh - var(--topbar-h));
}
.shell.no-toc {
  grid-template-columns: var(--side-w) minmax(0, 1fr);
}

/* Left sidebar */
.sidebar {
  position: sticky; top: var(--topbar-h);
  height: calc(100vh - var(--topbar-h));
  overflow-y: auto; overscroll-behavior: contain;
  border-right: 1px solid var(--border);
  padding: 16px 14px 48px;
  background: var(--bg);
}
.side-filter {
  width: 100%; height: 32px; padding: 0 10px; margin-bottom: 12px;
  background: var(--surface); color: var(--fg);
  border: 1px solid var(--border); border-radius: 7px;
  font: inherit; font-size: 13px;
}
.side-filter:focus { border-color: var(--accent); outline: none; }
.nav-section { margin-bottom: 14px; }
.nav-section-btn {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  padding: 6px 8px; border: 0; background: transparent; cursor: pointer;
  font: inherit; font-size: 11.5px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--fg-muted); border-radius: 6px;
}
.nav-section-btn:hover { color: var(--fg); background: var(--surface); }
.nav-section-btn .chev { transition: transform 0.15s; font-size: 11px; }
.nav-section-btn[aria-expanded="false"] .chev { transform: rotate(-90deg); }
.nav-list { list-style: none; margin: 2px 0 0; padding: 0; }
.nav-list[hidden] { display: none; }
.nav-item a {
  display: flex; align-items: baseline; justify-content: space-between; gap: 6px;
  padding: 5px 10px; border-radius: 6px; font-size: 13.5px; line-height: 1.4;
  color: var(--fg-muted); border-left: 2px solid transparent;
}
.nav-item a:hover { color: var(--fg); background: var(--surface); text-decoration: none; }
.nav-item a[aria-current="page"] {
  color: var(--accent); background: var(--accent-bg);
  border-left-color: var(--accent); font-weight: 600;
}
.nav-fw {
  font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--fg-muted); opacity: 0.85; flex-shrink: 0;
}
.nav-sub-row { display: flex; align-items: center; gap: 2px; }
.nav-sub-row > a { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nav-sub-toggle {
  flex: 0 0 24px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
  border: 0; background: transparent; color: var(--fg-muted); cursor: pointer; border-radius: 5px;
  font-size: 10px;
}
.nav-sub-toggle:hover { background: var(--surface); color: var(--fg); }
.nav-sub-toggle[aria-expanded="true"] .chev { transform: rotate(90deg); display: inline-block; }
.nav-sublist {
  list-style: none; margin: 2px 0 6px 12px; padding: 0 0 0 8px;
  border-left: 1px solid var(--border);
}
.nav-sublist[hidden] { display: none; }
.nav-sublist a { font-size: 12.5px; padding: 4px 8px; }
.nav-subgroup-btn {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  padding: 5px 10px; margin-top: 4px; border: 0; background: transparent; cursor: pointer;
  font: inherit; font-size: 12.5px; font-weight: 600; color: var(--fg-muted); border-radius: 6px;
}
.nav-subgroup-btn:hover { background: var(--surface); color: var(--fg); }
.nav-subgroup-btn[aria-expanded="false"] .chev { transform: rotate(-90deg); }

/* Center reading column */
.content {
  min-width: 0;
  padding: 32px 44px 80px;
  max-width: 860px;
  width: 100%;
  margin: 0 auto;
}
.content.wide { max-width: 1060px; }

/* Breadcrumbs */
.crumbs {
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
  font-size: 12.5px; color: var(--fg-muted); margin-bottom: 14px;
}
.crumbs a { color: var(--fg-muted); }
.crumbs a:hover { color: var(--accent); }
.crumbs .sep { opacity: 0.5; }

/* Docs landing hero cards (index.html only) */
.docs-hero {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px 22px;
  margin: 0 0 26px;
}
.docs-hero-top {
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 10px; margin-bottom: 14px;
}
.docs-hero-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fg-muted); }
.docs-stats { display: flex; gap: 8px; flex-wrap: wrap; }
.stat-pill {
  font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 999px;
  background: var(--bg); border: 1px solid var(--border); color: var(--fg);
}
.stat-pill strong { color: var(--accent); }
.path-grid {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}
@media (max-width: 600px) { .path-grid { grid-template-columns: 1fr; } }
.path-card {
  display: block; padding: 13px 14px; border-radius: 9px;
  background: var(--bg); border: 1px solid var(--border);
  color: var(--fg); transition: border-color 0.15s, transform 0.12s;
}
.path-card:hover { border-color: var(--accent); text-decoration: none; transform: translateY(-1px); }
.path-card-kicker { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--accent); margin-bottom: 4px; }
.path-card-title { font-size: 14.5px; font-weight: 650; margin-bottom: 3px; }
.path-card-desc { font-size: 12.5px; color: var(--fg-muted); line-height: 1.45; }

/* Typography */
.prose h1, .prose h2, .prose h3, .prose h4 {
  line-height: 1.3; font-weight: 680; letter-spacing: -0.015em; color: var(--fg);
}
.prose h1 { font-size: 2rem; margin: 0 0 0.7em; padding-bottom: 0.35em; border-bottom: 1px solid var(--border); }
.prose h2 { font-size: 1.42rem; margin: 2em 0 0.6em; padding-bottom: 0.25em; border-bottom: 1px solid var(--border); position: relative; }
.prose h3 { font-size: 1.14rem; margin: 1.5em 0 0.45em; position: relative; }
.prose h4 { font-size: 1rem; margin: 1.3em 0 0.4em; }
.heading-anchor {
  margin-left: 7px; font-weight: 500; color: var(--fg-muted); opacity: 0;
  text-decoration: none !important; transition: opacity 0.12s;
}
.prose h2:hover .heading-anchor,
.prose h3:hover .heading-anchor,
.heading-anchor:focus-visible { opacity: 1; color: var(--accent); }
.prose p { margin: 0.9em 0; }
.prose ul, .prose ol { padding-left: 1.5em; margin: 0.8em 0; }
.prose li { margin: 0.32em 0; }
.prose hr { border: 0; border-top: 1px solid var(--border); margin: 2.2em 0; }
.prose img { max-width: 100%; height: auto; border-radius: 10px; border: 1px solid var(--border); }
.contrib img { border-radius: 10px; vertical-align: middle; border: 1px solid var(--border); }
.contrib a { display: inline-block; margin: 0 5px 5px 0; }

/* Code blocks + copy button */
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.prose :not(pre) > code {
  background: var(--inline-code-bg); padding: 0.15em 0.38em; border-radius: 5px;
  font-size: 0.875em; border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
}
.code-wrap { position: relative; margin: 1.15em 0; }
.code-wrap pre {
  margin: 0; background: var(--code-bg); border: 1px solid var(--border);
  border-radius: 9px; padding: 14px 16px; overflow-x: auto;
  font-size: 13.5px; line-height: 1.55;
}
.code-wrap pre code { background: none; border: 0; padding: 0; font-size: inherit; }
.copy-btn {
  position: absolute; top: 8px; right: 8px;
  padding: 4px 8px; border-radius: 6px;
  background: var(--surface); color: var(--fg-muted);
  border: 1px solid var(--border); font-size: 11.5px; font-weight: 600;
  cursor: pointer; opacity: 0; transition: opacity 0.15s, color 0.15s, border-color 0.15s;
}
.code-wrap:hover .copy-btn, .copy-btn:focus-visible, .copy-btn.copied { opacity: 1; }
.copy-btn:hover { color: var(--fg); border-color: var(--border-strong); }
.copy-btn.copied { color: var(--ok); border-color: var(--ok); }

/* Blockquotes & GitHub-style Callouts */
.prose blockquote {
  margin: 1.2em 0; padding: 0.3em 1.1em;
  border-left: 3px solid var(--border-strong);
  color: var(--fg-muted); background: var(--surface); border-radius: 0 8px 8px 0;
}
.callout {
  margin: 1.25em 0; padding: 12px 16px; border-radius: 8px;
  border: 1px solid var(--border); border-left-width: 4px;
  background: var(--surface);
}
.callout-title {
  font-size: 12.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em;
  margin-bottom: 5px;
}
.callout p:first-of-type { margin-top: 0; }
.callout p:last-of-type { margin-bottom: 0; }
.callout-note { border-left-color: var(--accent); }
.callout-note .callout-title { color: var(--accent); }
.callout-tip { border-left-color: var(--ok); }
.callout-tip .callout-title { color: var(--ok); }
.callout-important { border-left-color: var(--purple); }
.callout-important .callout-title { color: var(--purple); }
.callout-warning { border-left-color: var(--warn); }
.callout-warning .callout-title { color: var(--warn); }
.callout-caution { border-left-color: var(--danger); }
.callout-caution .callout-title { color: var(--danger); }

/* Responsive tables + filter */
.table-tools {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin: 1.1em 0 0.5em; flex-wrap: wrap;
}
.table-filter {
  flex: 1; min-width: 220px; max-width: 360px; height: 34px; padding: 0 11px;
  background: var(--surface); color: var(--fg);
  border: 1px solid var(--border); border-radius: 7px; font: inherit; font-size: 13.5px;
}
.table-filter:focus { border-color: var(--accent); outline: none; }
.table-count { font-size: 12.5px; color: var(--fg-muted); }
.table-wrap {
  overflow: auto; max-inline-size: 100%; max-block-size: min(640px, 75vh);
  margin: 0.9em 0 1.4em; border: 1px solid var(--border); border-radius: 9px;
}
.table-wrap table {
  border-collapse: separate; border-spacing: 0; width: 100%; font-size: 13.5px; margin: 0;
}
.table-wrap th, .table-wrap td {
  border-bottom: 1px solid var(--border); border-right: 1px solid var(--border);
  padding: 8px 11px; text-align: left; vertical-align: top;
}
.table-wrap th:last-child, .table-wrap td:last-child { border-right: 0; }
.table-wrap tbody tr:last-child td { border-bottom: 0; }
.table-wrap thead th {
  position: sticky; inset-block-start: 0; z-index: 2;
  background: var(--surface); font-weight: 650; white-space: nowrap;
}
.table-wrap tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--surface) 45%, var(--bg)); }
.table-wrap tbody tr:hover td { background: var(--surface); }

/* Right-hand On This Page TOC */
.toc {
  position: sticky; top: var(--topbar-h);
  height: calc(100vh - var(--topbar-h));
  overflow-y: auto; overscroll-behavior: contain;
  padding: 28px 16px 40px 12px;
  border-left: 1px solid var(--border);
}
.toc-title {
  font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.07em; color: var(--fg-muted); margin: 0 0 10px 8px;
}
.toc ul { list-style: none; margin: 0; padding: 0; }
.toc li a {
  display: block; padding: 4px 8px; font-size: 12.5px; line-height: 1.4;
  color: var(--fg-muted); border-left: 2px solid transparent; border-radius: 0 5px 5px 0;
}
.toc li.toc-h3 a { padding-left: 18px; font-size: 12px; }
.toc li a:hover { color: var(--fg); text-decoration: none; }
.toc li a.active { color: var(--accent); border-left-color: var(--accent); font-weight: 600; }

/* Prev / Next pagination + footer */
.pager {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px;
  margin-top: 44px; padding-top: 24px; border-top: 1px solid var(--border);
}
.pager-card {
  display: block; padding: 12px 15px; border-radius: 9px;
  border: 1px solid var(--border); background: var(--surface); color: var(--fg);
}
.pager-card:hover { border-color: var(--accent); text-decoration: none; }
.pager-card.next { text-align: right; }
.pager-dir { font-size: 11.5px; color: var(--fg-muted); margin-bottom: 3px; }
.pager-title { font-size: 14px; font-weight: 600; color: var(--accent); }
.foot {
  margin-top: 28px; padding-top: 16px; border-top: 1px solid var(--border);
  color: var(--fg-muted); font-size: 12.5px; display: flex; gap: 18px; flex-wrap: wrap;
}
.foot a { color: var(--fg-muted); }
.foot a:hover { color: var(--accent); }

/* Native Search Modal Dialog (follows modern-web-guidance: dialog + light-dismiss) */
dialog#search-modal {
  padding: 0; border: 1px solid var(--border-strong); border-radius: 12px;
  background: var(--bg); color: var(--fg); box-shadow: var(--shadow);
  width: min(640px, calc(100dvw - 24px)); max-height: min(560px, 80dvh);
  margin: 10dvh auto auto; overflow: hidden;
}
dialog#search-modal[open] { display: flex; flex-direction: column; }
dialog#search-modal:modal { overscroll-behavior: contain; }
dialog#search-modal::backdrop {
  background: rgba(0, 0, 0, 0.56);
  backdrop-filter: blur(3px);
  overflow: hidden;
  overscroll-behavior: contain;
}
.search-head {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border-bottom: 1px solid var(--border);
}
.search-head input {
  flex: 1; border: 0; background: transparent; color: var(--fg);
  font: inherit; font-size: 15px; outline: none;
}
.search-close {
  border: 1px solid var(--border); background: var(--surface); color: var(--fg-muted);
  border-radius: 6px; padding: 3px 8px; font-size: 12px; cursor: pointer;
}
.search-close:hover { color: var(--fg); border-color: var(--border-strong); }
.search-results {
  overflow-y: auto; padding: 8px; flex: 1;
}
.search-hit {
  display: block; padding: 9px 11px; border-radius: 8px; color: var(--fg);
  border: 1px solid transparent;
}
.search-hit:hover, .search-hit.sel {
  background: var(--surface); border-color: var(--border); text-decoration: none;
}
.search-hit-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.search-hit-title { font-weight: 600; font-size: 14px; color: var(--accent); }
.search-hit-sec { font-size: 11px; color: var(--fg-muted); white-space: nowrap; }
.search-hit-snip { font-size: 12.5px; color: var(--fg-muted); margin-top: 2px; line-height: 1.4; }
.search-empty { padding: 24px 12px; text-align: center; color: var(--fg-muted); font-size: 13.5px; }
.search-foot {
  display: flex; justify-content: space-between; padding: 8px 14px;
  border-top: 1px solid var(--border); background: var(--surface);
  font-size: 11.5px; color: var(--fg-muted);
}

/* Responsive breakpoints */
@media (max-width: 1200px) {
  .shell { grid-template-columns: var(--side-w) minmax(0, 1fr); }
  .toc { display: none; }
}
@media (max-width: 900px) {
  .topbar-nav { display: none; }
  .search-trigger { min-width: 0; padding: 0 9px; }
  .search-trigger .search-label, .search-trigger kbd { display: none; }
  #menu-btn { display: inline-flex; }
  .shell, .shell.no-toc { display: block; }
  .sidebar {
    position: fixed; inset: var(--topbar-h) auto 0 0; z-index: 35;
    width: min(310px, 85dvw); height: calc(100dvh - var(--topbar-h));
    box-shadow: var(--shadow); transform: translateX(-105%);
    transition: transform 0.2s ease;
  }
  .sidebar.open { transform: translateX(0); }
  .content { padding: 22px 18px 72px; }
  .pager { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  .sidebar, .path-card, .nav-section-btn .chev { transition: none; }
}
"""

JS = r"""
(function () {
  "use strict";

  // 1. Two-state theme toggle (follows system by default, reverts to system when toggled back)
  var themeMeta = document.querySelector('meta[name="color-scheme"]');
  var themeBtn = document.getElementById("theme-btn");
  function systemScheme() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function currentRenderedScheme() {
    var stored = null;
    try { stored = localStorage.getItem("color-scheme"); } catch (e) {}
    return (stored === "light" || stored === "dark") ? stored : systemScheme();
  }
  if (themeBtn && themeMeta) {
    themeBtn.addEventListener("click", function () {
      var target = currentRenderedScheme() === "dark" ? "light" : "dark";
      var sys = systemScheme();
      try {
        if (target === sys) localStorage.removeItem("color-scheme");
        else localStorage.setItem("color-scheme", target);
      } catch (e) {}
      themeMeta.content = target === sys ? "light dark" : target;
    });
    window.addEventListener("storage", function (e) {
      if (e.key === "color-scheme") {
        themeMeta.content = (e.newValue === "light" || e.newValue === "dark") ? e.newValue : "light dark";
      }
    });
  }

  // 2. Mobile sidebar toggle
  var menuBtn = document.getElementById("menu-btn");
  var sidebar = document.getElementById("sidebar");
  if (menuBtn && sidebar) {
    menuBtn.addEventListener("click", function () {
      var open = sidebar.classList.toggle("open");
      menuBtn.setAttribute("aria-expanded", String(open));
    });
    document.addEventListener("click", function (e) {
      if (sidebar.classList.contains("open") && !sidebar.contains(e.target) && !menuBtn.contains(e.target)) {
        sidebar.classList.remove("open");
        menuBtn.setAttribute("aria-expanded", "false");
      }
    });
  }

  // 3. Collapsible sidebar sections & model subtrees (accessible <button aria-expanded>)
  document.querySelectorAll("[data-toggle-target]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var target = document.getElementById(btn.getAttribute("data-toggle-target"));
      if (!target) return;
      var expanded = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!expanded));
      target.hidden = expanded;
    });
  });

  // 4. Sidebar quick filter (auto-expands matching sections/models)
  var sideFilter = document.getElementById("side-filter");
  if (sideFilter) {
    sideFilter.addEventListener("input", function () {
      var q = sideFilter.value.trim().toLowerCase();
      document.querySelectorAll(".nav-section").forEach(function (sec) {
        var list = sec.querySelector(".nav-list");
        var btn = sec.querySelector(".nav-section-btn");
        var anyVisible = false;
        sec.querySelectorAll("li.nav-item").forEach(function (li) {
          var text = li.textContent.toLowerCase();
          var hit = !q || text.indexOf(q) > -1;
          li.style.display = hit ? "" : "none";
          if (hit) anyVisible = true;
          var sub = li.querySelector(".nav-sublist");
          if (sub && q && hit) sub.hidden = false;
        });
        sec.style.display = anyVisible ? "" : "none";
        if (list && q && anyVisible) {
          list.hidden = false;
          if (btn) btn.setAttribute("aria-expanded", "true");
        }
      });
    });
  }

  // 5. Copy buttons on code blocks
  document.querySelectorAll(".code-wrap").forEach(function (wrap) {
    var btn = wrap.querySelector(".copy-btn");
    var code = wrap.querySelector("code");
    if (!btn || !code) return;
    btn.addEventListener("click", function () {
      var txt = code.textContent || "";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () {
          btn.textContent = "Copied";
          btn.classList.add("copied");
          setTimeout(function () { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 1500);
        });
      }
    });
  });

  // 6. Interactive filter input on large tables (>= 8 body rows)
  document.querySelectorAll(".table-wrap").forEach(function (wrap) {
    var table = wrap.querySelector("table");
    if (!table || !table.tBodies.length) return;
    var rows = Array.prototype.slice.call(table.tBodies[0].rows);
    if (rows.length < 8) return;
    var tools = document.createElement("div");
    tools.className = "table-tools";
    var input = document.createElement("input");
    input.type = "search";
    input.className = "table-filter";
    input.placeholder = "Filter " + rows.length + " rows by model, firmware, SoC, status…";
    input.setAttribute("aria-label", "Filter table rows");
    var count = document.createElement("span");
    count.className = "table-count";
    count.textContent = rows.length + " rows";
    tools.appendChild(input);
    tools.appendChild(count);
    wrap.parentNode.insertBefore(tools, wrap);
    input.addEventListener("input", function () {
      var q = input.value.trim().toLowerCase();
      var shown = 0;
      rows.forEach(function (tr) {
        var match = !q || tr.textContent.toLowerCase().indexOf(q) > -1;
        tr.style.display = match ? "" : "none";
        if (match) shown++;
      });
      count.textContent = shown === rows.length ? (rows.length + " rows") : (shown + " of " + rows.length + " rows");
    });
  });

  // 7. Right-hand TOC scroll-spy
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll(".toc a[href^='#']"));
  if (tocLinks.length && "IntersectionObserver" in window) {
    var headings = tocLinks.map(function (a) {
      return document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1)));
    }).filter(Boolean);
    var activeId = null;
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) activeId = entry.target.id;
      });
      if (!activeId) return;
      tocLinks.forEach(function (a) {
        a.classList.toggle("active", a.getAttribute("href") === "#" + activeId);
      });
    }, { rootMargin: "-72px 0px -70% 0px", threshold: 0 });
    headings.forEach(function (h) { obs.observe(h); });
  }

  // 8. Full-site Search Modal (<dialog closedby="any"> + Safari light-dismiss fallback)
  var modal = document.getElementById("search-modal");
  var openSearchBtn = document.getElementById("search-open");
  var searchInput = document.getElementById("search-input");
  var searchResults = document.getElementById("search-results");
  var rootPrefix = document.body.getAttribute("data-root") || "";
  var indexData = null;
  var selIdx = 0;

  function loadIndex() {
    if (indexData) return Promise.resolve(indexData);
    return fetch(rootPrefix + "search-index.json")
      .then(function (r) { return r.json(); })
      .then(function (d) { indexData = d; return d; })
      .catch(function () { return []; });
  }

  function escHtml(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function renderHits(q) {
    if (!indexData) return;
    var terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    var scored = [];
    indexData.forEach(function (item) {
      var titleL = item.t.toLowerCase();
      var pathL = item.u.toLowerCase();
      var headL = (item.h || "").toLowerCase();
      var bodyL = (item.b || "").toLowerCase();
      if (!terms.length) {
        if (item.p) scored.push({ item: item, score: item.p });
        return;
      }
      var score = 0;
      for (var i = 0; i < terms.length; i++) {
        var term = terms[i];
        var s = 0;
        if (titleL.indexOf(term) > -1) s += 12;
        if (pathL.indexOf(term) > -1) s += 9;
        if (headL.indexOf(term) > -1) s += 5;
        if (bodyL.indexOf(term) > -1) s += 2;
        if (!s) return;
        score += s;
      }
      scored.push({ item: item, score: score + (item.p || 0) * 0.2 });
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    var top = scored.slice(0, 16);
    selIdx = 0;
    if (!top.length) {
      searchResults.innerHTML = '<div class="search-empty">No matching docs found. Try a model (e.g. <code>50A51HUV</code>), firmware (<code>Q0813</code>), or topic (<code>lane 3</code>).</div>';
      return;
    }
    searchResults.innerHTML = top.map(function (entry, idx) {
      var it = entry.item;
      return '<a class="search-hit' + (idx === 0 ? " sel" : "") + '" href="' + rootPrefix + it.u + '">' +
        '<div class="search-hit-top"><span class="search-hit-title">' + escHtml(it.t) + '</span>' +
        '<span class="search-hit-sec">' + escHtml(it.s) + '</span></div>' +
        (it.b ? '<div class="search-hit-snip">' + escHtml(it.b) + '</div>' : "") +
        "</a>";
    }).join("");
  }

  function openSearch() {
    if (!modal) return;
    if (!modal.open) modal.showModal();
    searchInput.focus();
    searchInput.select();
    loadIndex().then(function () { renderHits(searchInput.value); });
  }

  if (openSearchBtn && modal) {
    openSearchBtn.addEventListener("click", openSearch);
    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openSearch();
      } else if (e.key === "/" && !modal.open && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "")) {
        e.preventDefault();
        openSearch();
      }
    });
    searchInput.addEventListener("input", function () { renderHits(searchInput.value); });
    searchInput.addEventListener("keydown", function (e) {
      var hits = searchResults.querySelectorAll(".search-hit");
      if (!hits.length) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selIdx = (selIdx + 1) % hits.length;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        selIdx = (selIdx - 1 + hits.length) % hits.length;
      } else if (e.key === "Enter") {
        e.preventDefault();
        hits[selIdx].click();
        return;
      } else {
        return;
      }
      hits.forEach(function (el, i) { el.classList.toggle("sel", i === selIdx); });
      hits[selIdx].scrollIntoView({ block: "nearest" });
    });
    // Safari fallback for closedby="any" (pointerdown + pointerup outside rect)
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      var outside = function (e) {
        var r = modal.getBoundingClientRect();
        return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      };
      var pressedOut = false;
      modal.addEventListener("pointerdown", function (e) { pressedOut = outside(e); });
      modal.addEventListener("pointerup", function (e) { if (pressedOut && outside(e)) modal.close(); });
    }
  }
})();
"""


def published() -> list:
    """Every markdown file that becomes a page, as repo-relative posix paths."""
    out = [p for p in ROOT_PAGES if (ROOT / p).exists()]
    for base in SCAN_DIRS:
        for path in sorted((ROOT / base).rglob("*.md")):
            rel = path.relative_to(ROOT)
            if SKIP_PARTS & set(rel.parts):
                continue
            out.append(rel.as_posix())
    return out


def page_url(rel: str) -> str:
    p = Path(rel)
    if p.name == "README.md":
        parent = p.parent.as_posix()
        return "index.html" if parent == "." else parent + "/index.html"
    return p.with_suffix(".html").as_posix()


def title_of(rel: str) -> str:
    try:
        text = (ROOT / rel).read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return Path(rel).stem
    for line in text.splitlines():
        if line.startswith("# "):
            return re.sub(r"[`*_]", "", line[2:].strip())
    return Path(rel).stem


def short_subpage_label(rel: str) -> str:
    """Clean, concise sidebar label for model subpages (EVIDENCE, findings/*)."""
    p = Path(rel)
    name = p.stem
    fixed = {
        "EVIDENCE": "Evidence",
        "MODDING": "Modding",
        "FINDINGS": "Findings index",
        "DOOM": "Doom on /dev/fb0",
        "LOCAL-LAUNCHER-NOTES": "Local launcher notes",
    }
    if name in fixed:
        return fixed[name]
    m = re.match(r"^(\d+)[-_](.+)$", name)
    if m:
        num, slug = m.group(1), m.group(2).replace("-", " ").replace("_", " ").strip()
        return f"{num} · {slug[:1].upper() + slug[1:]}"
    return name.replace("-", " ").replace("_", " ")


def slugger():
    """GitHub-compatible heading anchors (keeps `_`, drops punctuation)."""
    seen = {}

    def slug(value, separator="-"):
        base = re.sub(r"[^\w\s-]", "", value.strip().lower())
        base = re.sub(r"\s", separator, base)
        n = seen.get(base, 0)
        seen[base] = n + 1
        return base if n == 0 else f"{base}-{n}"

    return slug


def gh_url(rel: str) -> str:
    target = ROOT / rel
    kind = "tree" if target.is_dir() else "blob"
    return f"{REPO}/{kind}/{BRANCH}/{rel}"


def rewrite_links(html_text: str, src_rel: str, pages: dict, asset_set=frozenset()) -> str:
    src_dir = Path(src_rel).parent.as_posix()

    def fix(match):
        attr, value = match.group(1), match.group(2)
        if not value or value.startswith(("http://", "https://", "mailto:", "tel:", "#", "data:")):
            return match.group(0)
        path, _, frag = value.partition("#")
        if not path:
            return match.group(0)
        joined = os.path.normpath(os.path.join(src_dir, path)).replace(os.sep, "/")
        if joined.startswith(".."):
            return f'{attr}="{gh_url(path.lstrip("./"))}"'
        target = joined.rstrip("/")
        if target in pages:
            dest = pages[target]
        elif (target + "/README.md") in pages:
            dest = pages[target + "/README.md"]
        elif attr == "src" and target in asset_set:
            rel = os.path.relpath(target, src_dir or ".").replace(os.sep, "/")
            return f'{attr}="{rel}"'
        else:
            return f'{attr}="{gh_url(target)}"'
        rel = os.path.relpath(dest, src_dir or ".").replace(os.sep, "/")
        return f'{attr}="{rel}{("#" + frag) if frag else ""}"'

    parts = re.split(r"(<pre\b.*?</pre>|<code\b.*?</code>)", html_text, flags=re.S)
    for i, part in enumerate(parts):
        if part.startswith(("<pre", "<code")):
            continue
        parts[i] = re.sub(r'(href|src)="([^"]*)"', fix, part)
    return "".join(parts)


def enhance_html(body: str) -> tuple[str, list[tuple[int, str, str]]]:
    """Post-process rendered markdown HTML:
    - Convert GitHub alert blockquotes (> [!NOTE] ...) into styled callouts
    - Wrap <table> in accessible scroll container (.table-wrap)
    - Wrap <pre><code> in .code-wrap with Copy button
    - Add anchor links to h2/h3 and extract ToC entries
    """
    # 1. GitHub-style alerts inside blockquotes
    alert_re = re.compile(
        r"<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*?)</p>(.*?)</blockquote>",
        flags=re.S,
    )

    def repl_alert(m):
        kind, first_p, rest = m.group(1), m.group(2).strip(), m.group(3)
        label, cls = ALERT_META[kind]
        first_html = f"<p>{first_p}</p>" if first_p else ""
        return f'<aside class="callout callout-{cls}"><div class="callout-title">{label}</div>{first_html}{rest}</aside>'

    body = alert_re.sub(repl_alert, body)

    # 2. Wrap tables in keyboard-accessible scroll region
    body = re.sub(
        r"<table>(.*?)</table>",
        r'<div tabindex="0" role="region" aria-label="Data table" class="table-wrap"><table>\1</table></div>',
        body,
        flags=re.S,
    )

    # 3. Wrap fenced code blocks with a Copy button
    body = re.sub(
        r"<pre><code(.*?)>(.*?)</code></pre>",
        r'<div class="code-wrap"><button type="button" class="copy-btn" aria-label="Copy code">Copy</button><pre><code\1>\2</code></pre></div>',
        body,
        flags=re.S,
    )

    # 4. Extract h2/h3 TOC and inject subtle # anchor links
    toc_items = []
    heading_re = re.compile(r'<h([23])\s+id="([^"]+)">(.*?)</h\1>', flags=re.S)

    def repl_heading(m):
        lvl, hid, inner = int(m.group(1)), m.group(2), m.group(3)
        plain = html_mod.unescape(re.sub(r"<[^>]+>", "", inner)).strip()
        toc_items.append((lvl, hid, plain))
        return f'<h{lvl} id="{hid}">{inner}<a class="heading-anchor" href="#{hid}" aria-label="Link to {html_mod.escape(plain)}">#</a></h{lvl}>'

    body = heading_re.sub(repl_heading, body)
    return body, toc_items


def build_model_tree(pages: dict) -> list:
    """Group docs/models/<Model>/<FW>/* into one clean entry per model/build."""
    groups: dict[tuple[str, str], dict] = {}
    for rel in pages:
        if not rel.startswith("docs/models/") or "/source/" in rel:
            continue
        parts = Path(rel).parts  # ('docs', 'models', '<Model>', '<FW>', ...)
        if len(parts) < 5:
            continue
        model, fw = parts[2], parts[3]
        key = (model, fw)
        entry = groups.setdefault(key, {"model": model, "fw": fw, "main": None, "subs": []})
        if len(parts) == 5 and parts[4] == "README.md":
            entry["main"] = rel
        else:
            entry["subs"].append(rel)

    out = []
    for key in sorted(groups, key=lambda k: (k[0].lower(), k[1].lower())):
        g = groups[key]
        subs = sorted(g["subs"], key=lambda r: (0 if "/findings/" not in r else 1, r))
        main_rel = g["main"] or (subs[0] if subs else None)
        if not main_rel:
            continue
        if g["main"] is None:
            subs = subs[1:]
        fw_short = re.sub(r"^V0{2,4}\.", "", g["fw"])
        out.append({
            "model": g["model"],
            "fw": fw_short,
            "fw_full": g["fw"],
            "main_rel": main_rel,
            "subs": [(short_subpage_label(r), r) for r in subs],
        })
    return out


def build_sidebar_model(pages: dict) -> tuple[list, list]:
    """Return (sections_structure, linear_reading_order_rels)."""
    sections = []
    order = []

    def add_curated(sec_tuple):
        title, default_open, links, subgroups = sec_tuple
        valid_links = [(lbl, rel) for lbl, rel in links if rel in pages]
        valid_subs = []
        for sg_title, sg_links in subgroups:
            sg_valid = [(lbl, rel) for lbl, rel in sg_links if rel in pages]
            if sg_valid:
                valid_subs.append((sg_title, sg_valid))
        for _, rel in valid_links:
            order.append(rel)
        sections.append({
            "kind": "curated",
            "title": title,
            "default_open": default_open,
            "links": valid_links,
            "subgroups": valid_subs,
        })

    for s in CURATED_SECTIONS:
        add_curated(s)

    models = build_model_tree(pages)
    for m in models:
        order.append(m["main_rel"])
    sections.append({
        "kind": "models",
        "title": f"Model Guides ({len(models)})",
        "default_open": False,
        "models": models,
    })

    add_curated(PROJECT_SECTION)
    return sections, order


def load_inventory_stats() -> dict:
    inv_path = ROOT / "docs/research/inventory.json"
    if not inv_path.exists():
        return {"builds": 0, "rooted": 0, "guides": 0}
    try:
        inv = json.loads(inv_path.read_text(encoding="utf-8"))
        fws = inv.get("firmwares", [])
        rooted = sum(1 for f in fws if f.get("capabilities", {}).get("root") == "achieved")
        guides = len(list((ROOT / "docs/models").glob("*/*/README.md")))
        return {"builds": len(fws), "rooted": rooted, "guides": guides}
    except (OSError, ValueError):
        return {"builds": 0, "rooted": 0, "guides": 0}


def section_for_page(rel: str) -> str:
    if rel in ("README.md", "SECURITY.md", "docs/DISCLOSURE.md"):
        return "Getting Started"
    if rel.startswith("docs/launcher/") or rel.startswith("tools/launcher-host/"):
        return "Launcher & Native Home"
    if rel.startswith("docs/models/"):
        parts = Path(rel).parts
        if len(parts) >= 4:
            return f"Model · {parts[2]}"
        return "Model Guides"
    if rel.startswith("docs/research/"):
        return "Research"
    if rel.startswith("docs/project/") or rel in ("AGENTS.md", "TODO.md", "docs/README.md"):
        return "Project"
    return "Tooling"


def topnav_bucket(rel: str) -> str:
    if rel == "README.md":
        return "overview"
    if rel.startswith("docs/launcher/") or rel.startswith("tools/launcher-host/"):
        return "launcher"
    if rel.startswith("docs/models/"):
        return "models"
    if rel.startswith("docs/research/") or rel == "docs/project/HACK-YOUR-OWN.md":
        return "research"
    if rel in ("SECURITY.md", "docs/DISCLOSURE.md"):
        return "security"
    return ""


def render_breadcrumbs(rel: str, pages: dict, url: str) -> str:
    base_dir = os.path.dirname(url) or "."

    def link(label: str, target_rel: str | None) -> str:
        if target_rel and target_rel in pages and target_rel != rel:
            href = os.path.relpath(pages[target_rel], base_dir).replace(os.sep, "/")
            return f'<a href="{href}">{html_mod.escape(label)}</a>'
        return f"<span>{html_mod.escape(label)}</span>"

    crumbs = [link("Docs", "README.md")]
    p = Path(rel)
    parts = p.parts
    if rel == "README.md":
        return '<nav class="crumbs" aria-label="Breadcrumb"><span>Docs</span><span class="sep">/</span><span>Overview</span></nav>'
    if parts[0] == "docs" and len(parts) >= 2:
        if parts[1] == "models":
            crumbs.append(link("Model Guides", "docs/models/README.md"))
            if len(parts) >= 5:
                model, fw = parts[2], parts[3]
                model_readme = f"docs/models/{model}/{fw}/README.md"
                fw_short = re.sub(r"^V0{2,4}\.", "", fw)
                crumbs.append(link(f"{model} ({fw_short})", model_readme))
                if parts[4] != "README.md":
                    crumbs.append(f"<span>{html_mod.escape(short_subpage_label(rel))}</span>")
        elif parts[1] == "launcher":
            crumbs.append(link("Launcher", "docs/launcher/LANES.md"))
            crumbs.append(f"<span>{html_mod.escape(title_of(rel))}</span>")
        elif parts[1] == "research":
            crumbs.append(link("Research", "docs/research/EXPLOITS.md"))
            crumbs.append(f"<span>{html_mod.escape(title_of(rel))}</span>")
        elif parts[1] == "project":
            crumbs.append(link("Project", "docs/project/STORY.md"))
            crumbs.append(f"<span>{html_mod.escape(title_of(rel))}</span>")
        else:
            crumbs.append(f"<span>{html_mod.escape(title_of(rel))}</span>")
    elif parts[0] == "tools":
        crumbs.append(link("Tools", "tools/README.md"))
        if len(parts) >= 2 and parts[1] == "launcher-host":
            crumbs.append(link("Native Home", "tools/launcher-host/IMPLEMENTATIONS.md"))
        crumbs.append(f"<span>{html_mod.escape(title_of(rel))}</span>")
    else:
        crumbs.append(f"<span>{html_mod.escape(title_of(rel))}</span>")

    return '<nav class="crumbs" aria-label="Breadcrumb">' + '<span class="sep">/</span>'.join(crumbs) + "</nav>"


def render_home_hero(stats: dict) -> str:
    return f"""
<section class="docs-hero" aria-label="Quick start paths">
  <div class="docs-hero-top">
    <span class="docs-hero-title">Documentation · Choose your path</span>
    <div class="docs-stats">
      <span class="stat-pill"><strong>{stats['builds']}</strong> tested builds</span>
      <span class="stat-pill"><strong>{stats['rooted']}</strong> rooted</span>
      <span class="stat-pill"><strong>{stats['guides']}</strong> model guides</span>
    </div>
  </div>
  <div class="path-grid">
    <a class="path-card" href="#quickstart--the-launcher">
      <div class="path-card-kicker">No Root · Safe</div>
      <div class="path-card-title">Custom Launcher</div>
      <div class="path-card-desc">Replace the ad-filled home screen over MQTT without touching root.</div>
    </a>
    <a class="path-card" href="docs/models/index.html">
      <div class="path-card-kicker">Model-Specific</div>
      <div class="path-card-title">Model &amp; Root Guides</div>
      <div class="path-card-desc">Match your exact model and firmware string across {stats['guides']} verified guides.</div>
    </a>
    <a class="path-card" href="docs/research/TESTED-MODELS.html">
      <div class="path-card-kicker">Compatibility</div>
      <div class="path-card-title">Tested Models Matrix</div>
      <div class="path-card-desc">Filter all {stats['builds']} reported VIDAA builds by SoC, firmware, and status.</div>
    </a>
    <a class="path-card" href="SECURITY.html">
      <div class="path-card-kicker">Policy &amp; Safety</div>
      <div class="path-card-title">Security &amp; Disclosure</div>
      <div class="path-card-desc">VIDAA-PSIRT-2026-005 status, the OTA tradeoff, and contributor rules.</div>
    </a>
  </div>
</section>
"""


def render_sidebar(sections: list, page_rel: str, pages: dict, url: str) -> str:
    base_dir = os.path.dirname(url) or "."

    def rel_href(target_rel: str) -> str:
        return os.path.relpath(pages[target_rel], base_dir).replace(os.sep, "/")

    chunks = []
    for idx, sec in enumerate(sections):
        sec_id = f"sec-{idx}"
        if sec["kind"] == "curated":
            all_rels = {r for _, r in sec["links"]}
            for _, sg_links in sec["subgroups"]:
                all_rels.update(r for _, r in sg_links)
            is_open = sec["default_open"] or (page_rel in all_rels)
            exp = "true" if is_open else "false"
            hid = "" if is_open else " hidden"
            chunks.append(
                f'<div class="nav-section">'
                f'<button type="button" class="nav-section-btn" aria-expanded="{exp}" aria-controls="{sec_id}" data-toggle-target="{sec_id}">'
                f'<span>{html_mod.escape(sec["title"])}</span><span class="chev" aria-hidden="true">▾</span></button>'
                f'<ul id="{sec_id}" class="nav-list"{hid}>'
            )
            for lbl, rel in sec["links"]:
                cur = ' aria-current="page"' if rel == page_rel else ""
                chunks.append(f'<li class="nav-item"><a href="{rel_href(rel)}"{cur}>{html_mod.escape(lbl)}</a></li>')
            for sidx, (sg_title, sg_links) in enumerate(sec["subgroups"]):
                sg_id = f"{sec_id}-sg-{sidx}"
                sg_open = any(r == page_rel for _, r in sg_links)
                sg_exp = "true" if sg_open else "false"
                sg_hid = "" if sg_open else " hidden"
                chunks.append(
                    f'<li class="nav-item">'
                    f'<button type="button" class="nav-subgroup-btn" aria-expanded="{sg_exp}" aria-controls="{sg_id}" data-toggle-target="{sg_id}">'
                    f'<span>{html_mod.escape(sg_title)}</span><span class="chev" aria-hidden="true">▾</span></button>'
                    f'<ul id="{sg_id}" class="nav-sublist"{sg_hid}>'
                )
                for lbl, rel in sg_links:
                    cur = ' aria-current="page"' if rel == page_rel else ""
                    chunks.append(f'<li class="nav-item"><a href="{rel_href(rel)}"{cur}>{html_mod.escape(lbl)}</a></li>')
                chunks.append("</ul></li>")
            chunks.append("</ul></div>")
        elif sec["kind"] == "models":
            in_models = page_rel.startswith("docs/models/") and page_rel not in ("docs/models/README.md", "docs/models/_TEMPLATE.md")
            is_open = sec["default_open"] or in_models
            exp = "true" if is_open else "false"
            hid = "" if is_open else " hidden"
            chunks.append(
                f'<div class="nav-section">'
                f'<button type="button" class="nav-section-btn" aria-expanded="{exp}" aria-controls="{sec_id}" data-toggle-target="{sec_id}">'
                f'<span>{html_mod.escape(sec["title"])}</span><span class="chev" aria-hidden="true">▾</span></button>'
                f'<ul id="{sec_id}" class="nav-list"{hid}>'
            )
            for midx, m in enumerate(sec["models"]):
                m_rels = {m["main_rel"]} | {r for _, r in m["subs"]}
                m_active = page_rel in m_rels
                cur = ' aria-current="page"' if page_rel == m["main_rel"] else ""
                label_html = f'<span>{html_mod.escape(m["model"])}</span><span class="nav-fw">{html_mod.escape(m["fw"])}</span>'
                if m["subs"]:
                    sub_id = f"mod-{midx}"
                    s_exp = "true" if m_active else "false"
                    s_hid = "" if m_active else " hidden"
                    chunks.append(
                        f'<li class="nav-item"><div class="nav-sub-row">'
                        f'<a href="{rel_href(m["main_rel"])}"{cur} title="{html_mod.escape(m["model"] + " / " + m["fw_full"])}">{label_html}</a>'
                        f'<button type="button" class="nav-sub-toggle" aria-expanded="{s_exp}" aria-controls="{sub_id}" data-toggle-target="{sub_id}" aria-label="Toggle {html_mod.escape(m["model"])} pages">'
                        f'<span class="chev" aria-hidden="true">▸</span></button></div>'
                        f'<ul id="{sub_id}" class="nav-sublist"{s_hid}>'
                    )
                    for slbl, srel in m["subs"]:
                        scur = ' aria-current="page"' if srel == page_rel else ""
                        chunks.append(f'<li class="nav-item"><a href="{rel_href(srel)}"{scur}>{html_mod.escape(slbl)}</a></li>')
                    chunks.append("</ul></li>")
                else:
                    chunks.append(
                        f'<li class="nav-item"><a href="{rel_href(m["main_rel"])}"{cur} title="{html_mod.escape(m["model"] + " / " + m["fw_full"])}">{label_html}</a></li>'
                    )
            chunks.append("</ul></div>")
    return "".join(chunks)


def render_pager(page_rel: str, order: list, pages: dict, url: str) -> str:
    if page_rel not in order:
        return ""
    idx = order.index(page_rel)
    base_dir = os.path.dirname(url) or "."
    prev_rel = order[idx - 1] if idx > 0 else None
    next_rel = order[idx + 1] if idx + 1 < len(order) else None

    def card(rel: str | None, direction: str, cls: str) -> str:
        if not rel:
            return "<div></div>"
        href = os.path.relpath(pages[rel], base_dir).replace(os.sep, "/")
        lbl = title_of(rel)
        if len(lbl) > 48:
            lbl = lbl[:47] + "…"
        return f'<a class="pager-card {cls}" href="{href}"><div class="pager-dir">{direction}</div><div class="pager-title">{html_mod.escape(lbl)}</div></a>'

    return f'<nav class="pager" aria-label="Page navigation">{card(prev_rel, "← Previous", "prev")}{card(next_rel, "Next →", "next")}</nav>'


def render(
    page_rel: str,
    pages: dict,
    sections: list,
    order: list,
    stats: dict,
    asset_set=frozenset(),
) -> tuple[str, dict]:
    text = (ROOT / page_rel).read_text(encoding="utf-8", errors="ignore")
    md = markdown.Markdown(
        extensions=["tables", "fenced_code", "sane_lists", "toc"],
        extension_configs={"toc": {"slugify": slugger(), "permalink": False}},
    )
    body = md.convert(text)
    body = rewrite_links(body, page_rel, pages, asset_set)
    body, toc_items = enhance_html(body)

    url = pages[page_rel]
    depth = url.count("/")
    up = "../" * depth
    base_dir = os.path.dirname(url) or "."

    def rel_link(target_rel: str) -> str:
        return os.path.relpath(pages[target_rel], base_dir).replace(os.sep, "/")

    bucket = topnav_bucket(page_rel)
    topnav_items = [
        ("overview", "Overview", "README.md"),
        ("launcher", "Launcher", "docs/launcher/LANES.md"),
        ("models", "Models", "docs/models/README.md"),
        ("research", "Research", "docs/research/TESTED-MODELS.md"),
        ("security", "Security", "SECURITY.md"),
    ]
    topnav_parts = []
    for b, lbl, trel in topnav_items:
        if trel not in pages:
            continue
        cur_attr = ' aria-current="true"' if b == bucket else ""
        topnav_parts.append(f'<a href="{rel_link(trel)}"{cur_attr}>{lbl}</a>')
    topnav_html = "".join(topnav_parts)

    sidebar_html = render_sidebar(sections, page_rel, pages, url)
    crumbs_html = render_breadcrumbs(page_rel, pages, url)
    pager_html = render_pager(page_rel, order, pages, url)
    hero_html = render_home_hero(stats) if page_rel == "README.md" else ""

    has_toc = len(toc_items) >= 2
    toc_html = ""
    if has_toc:
        toc_lis = "".join(
            f'<li class="toc-h{lvl}"><a href="#{hid}">{html_mod.escape(plain)}</a></li>'
            for lvl, hid, plain in toc_items
        )
        toc_html = f'<aside class="toc" aria-label="On this page"><div class="toc-title">On this page</div><ul>{toc_lis}</ul></aside>'

    shell_cls = "shell" if has_toc else "shell no-toc"
    content_cls = "content wide" if page_rel in WIDE_PAGES else "content"

    edit = f"{REPO}/blob/{BRANCH}/{page_rel}"
    page_title = title_of(page_rel)
    doc_title = "alvidaa — VIDAA launcher & root documentation" if page_rel == "README.md" else f"{page_title} — alvidaa docs"

    # Build compact search index entry (skip archived source/ dumps)
    plain_excerpt = re.sub(r"<[^>]+>", " ", body)
    plain_excerpt = re.sub(r"\s+", " ", html_mod.unescape(plain_excerpt)).strip()
    if plain_excerpt.lower().startswith(page_title.lower()):
        plain_excerpt = plain_excerpt[len(page_title):].strip(" —-:")
    priority = 0
    if page_rel in ("README.md", "docs/research/TESTED-MODELS.md", "docs/models/README.md", "docs/launcher/LANES.md", "SECURITY.md", "docs/DISCLOSURE.md"):
        priority = 6
    elif page_rel.startswith("docs/models/") and page_rel.endswith("/README.md"):
        priority = 4
    elif page_rel.startswith(("docs/launcher/", "docs/research/", "tools/launcher-host/")):
        priority = 3

    search_entry = {
        "u": url,
        "t": page_title,
        "s": section_for_page(page_rel),
        "h": " · ".join(p for _, _, p in toc_items[:12]),
        "b": plain_excerpt[:160],
        "p": priority,
    }

    html_doc = f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<script>try{{var s=localStorage.getItem("color-scheme");if(s==="light"||s==="dark")document.querySelector('meta[name="color-scheme"]').content=s;}}catch(e){{}}</script>
<title>{html_mod.escape(doc_title)}</title>
<style>{CSS}</style>
</head><body data-root="{up}">

<header class="topbar">
  <button type="button" id="menu-btn" class="icon-btn" aria-label="Toggle navigation menu" aria-expanded="false" aria-controls="sidebar">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
  </button>
  <a class="topbar-brand" href="{up}index.html">
    <span>alvidaa</span>
    <span class="topbar-badge">docs</span>
  </a>
  <nav class="topbar-nav" aria-label="Primary">{topnav_html}</nav>
  <div class="topbar-spacer"></div>
  <button type="button" id="search-open" class="search-trigger" aria-label="Search documentation">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <span class="search-label">Search docs…</span>
    <kbd>⌘K</kbd>
  </button>
  <button type="button" id="theme-btn" class="icon-btn" aria-label="Toggle color theme" title="Toggle light/dark theme">
    <svg class="icon-sun" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
    <svg class="icon-moon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
  </button>
  <a class="icon-btn" href="{REPO}" aria-label="GitHub repository" title="View on GitHub">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55v-1.94c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.25.45-2.28 1.19-3.08-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.8 1.19 1.83 1.19 3.08 0 4.41-2.7 5.39-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.66.79.55A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z"/></svg>
  </a>
</header>

<div class="{shell_cls}">
  <aside id="sidebar" class="sidebar" aria-label="Documentation navigation">
    <input id="side-filter" class="side-filter" type="search" placeholder="Filter sidebar…" aria-label="Filter sidebar links">
    {sidebar_html}
  </aside>

  <main class="{content_cls}">
    {crumbs_html}
    {hero_html}
    <article class="prose">
      {body}
    </article>
    {pager_html}
    <footer class="foot">
      <a href="{edit}">Edit this page on GitHub</a>
      <a href="{REPO}">Repository</a>
      <a href="{rel_link('SECURITY.md')}">Security &amp; disclosure</a>
      <a href="{rel_link('docs/DISCLOSURE.md')}">Publication policy</a>
    </footer>
  </main>

  {toc_html}
</div>

<dialog id="search-modal" closedby="any" aria-labelledby="search-title">
  <h1 id="search-title" class="sr-only">Search alvidaa documentation</h1>
  <div class="search-head">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <input id="search-input" type="search" placeholder="Search models, firmware (e.g. Q0813), launcher, guides…" aria-label="Search documentation" autofocus>
    <form method="dialog"><button type="submit" class="search-close">Esc</button></form>
  </div>
  <div id="search-results" class="search-results"></div>
  <div class="search-foot">
    <span>↑↓ navigate · Enter open</span>
    <span>Press Esc or click outside to close</span>
  </div>
</dialog>

<script>{JS}</script>
</body></html>
"""
    return html_doc, search_entry


def assets() -> set:
    """Repo-relative paths of images referenced by published pages."""
    md_img = re.compile(r"!\[[^\]]*\]\(([^)\s]+)")
    html_img = re.compile(r"<img[^>]+src=[\"']([^\"']+)[\"']", re.I)
    found = set()
    for rel in published():
        text = (ROOT / rel).read_text(encoding="utf-8", errors="ignore")
        base = (ROOT / rel).parent
        for m in list(md_img.finditer(text)) + list(html_img.finditer(text)):
            ref = m.group(1).split("#")[0].split("?")[0]
            if not ref or "://" in ref or ref.startswith("data:"):
                continue
            target = (base / ref).resolve()
            try:
                relp = target.relative_to(ROOT)
            except ValueError:
                continue
            if target.is_file():
                found.add(relp.as_posix())
    return found


def build(out: Path) -> int:
    pages = {rel: page_url(rel) for rel in published()}
    sections, order = build_sidebar_model(pages)
    stats = load_inventory_stats()
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    (out / ".nojekyll").write_text("", encoding="utf-8")
    asset_set = assets()
    search_index = []
    for rel, url in pages.items():
        html_doc, search_entry = render(rel, pages, sections, order, stats, asset_set)
        dest = out / url
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(html_doc, encoding="utf-8")
        if "/source/" not in rel:
            search_index.append(search_entry)
    (out / "search-index.json").write_text(
        json.dumps(search_index, separators=(",", ":"), ensure_ascii=False),
        encoding="utf-8",
    )
    for rel in sorted(asset_set):
        dest = out / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / rel, dest)
    return len(pages)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default="site", help="output directory (default: site)")
    ap.add_argument("--check", action="store_true", help="build to a temp dir and report")
    args = ap.parse_args()

    try:
        import markdown  # noqa: F401
    except ImportError:
        print("gen-site: the 'markdown' package is required (pip install markdown)", file=sys.stderr)
        return 2
    if args.check:
        with tempfile.TemporaryDirectory() as tmp:
            n = build(Path(tmp))
        print(f"site builds: {n} pages")
        return 0

    n = build((ROOT / args.out) if not os.path.isabs(args.out) else Path(args.out))
    print(f"site: {n} pages -> {args.out}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
