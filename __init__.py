"""Agent-side registration shim for the cn-plugins-market desktop plugin.

This checkout is the *source* repo; the copy the Desktop app actually loads
lives in ``<app root>/desktop-plugins/cn-plugins-market`` and is synced from
here by ``sync-plugin.ps1``. Hermes still scans every directory under
``plugins/`` as an agent plugin and refuses one without ``__init__.py``
("No __init__.py in …"), so this shim exists only to satisfy the loader.

The plugin contributes no agent tools and no hooks.
"""


def register(ctx) -> None:
    """No-op: this plugin is a desktop catalog page, not an agent plugin."""
    return None
