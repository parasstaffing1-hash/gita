"""The app-wide request ceiling.

`slowapi`'s own middleware cannot resolve a route handler through Starlette
1.6's included-router wrappers, so it exempts every request and the setting
protects nothing. That failure is silent and looks exactly like working
configuration, which is why it is asserted here rather than trusted.
"""

from __future__ import annotations

import pytest

from gita_api.security.default_limit import DefaultRateLimitMiddleware


def test_the_ceiling_is_installed_and_is_not_slowapis():
    from gita_api.main import app

    installed = [m.cls for m in app.user_middleware]
    assert DefaultRateLimitMiddleware in installed

    # If this ever comes back, the ceiling silently stops working.
    assert not any(m.__name__.startswith("SlowAPI") for m in installed)


def test_the_bucket_key_prefers_the_signed_in_user():
    from gita_api.security.rate_limit import identify

    anonymous = {"headers": [], "client": ("203.0.113.7", 51234)}
    signed_in = {
        "headers": [(b"authorization", b"Bearer abcdef123456")],
        "client": ("203.0.113.7", 51234),
    }
    # One busy network must not exhaust a signed-in reader's quota, so the two
    # cannot share a bucket even from the same address.
    assert identify(anonymous) != identify(signed_in)
    assert identify(anonymous) == "203.0.113.7"

    # A client-less scope still yields a usable key rather than raising.
    assert identify({"headers": [], "client": None}) == "unknown"


@pytest.mark.parametrize("path", ["/health"])
def test_liveness_is_never_rationed(path, client):
    # A rate-limited health check reads as an outage to whatever is watching it.
    for _ in range(50):
        assert client.get(path).status_code == 200
