"""Account lifecycle, conflict-safe sync, and the write guard.

These are the regression tests for four defects found by exercising the running
API rather than by unit-testing its parts:

  1. passlib 1.7.4 could not hash any password against bcrypt 5.x, so
     registration and login both returned 500. Nothing caught it because the
     contract tests only asserted that endpoints *reject* anonymous callers.
  2. `/v1/sync/pull` raised AttributeError because `CollectionItem` has no
     `user_id` column.
  3. The push path resolved ownership with `getattr(row, "user_id", None)` and
     read `None` as "allowed", which let any signed-in account overwrite
     another account's collection item.
  4. The canonical write guard was installed from the FastAPI lifespan, so
     every CLI script opened unguarded sessions.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

pytestmark = pytest.mark.db


def _now() -> str:
    return datetime.now(UTC).isoformat()


@pytest.fixture
def account(client):
    """Register a fresh account and return its auth header."""

    def _make() -> dict[str, str]:
        email = f"test-{uuid.uuid4().hex[:12]}@example.com"
        response = client.post(
            "/v1/auth/register", json={"email": email, "password": "a-long-enough-password"}
        )
        assert response.status_code == 201, response.text
        return {"Authorization": f"Bearer {response.json()['accessToken']}"}

    return _make


# --- Password hashing -----------------------------------------------------


def test_passwords_can_actually_be_hashed():
    """The regression that broke every account operation.

    passlib's bcrypt backend probed `bcrypt.__about__`, removed in bcrypt 5,
    then fed bcrypt an over-long string. Hashing is now done directly.
    """
    from gita_api.security.auth import hash_password, verify_password

    hashed = hash_password("a-long-enough-password")
    assert verify_password("a-long-enough-password", hashed)
    assert not verify_password("something else", hashed)


def test_long_passwords_are_not_silently_truncated():
    """bcrypt reads only 72 bytes. Without a pre-hash, two passwords sharing a
    72-byte prefix would authenticate each other."""
    from gita_api.security.auth import hash_password, verify_password

    hashed = hash_password("x" * 200 + "A")
    assert verify_password("x" * 200 + "A", hashed)
    assert not verify_password("x" * 200 + "B", hashed)


def test_a_corrupt_stored_hash_reads_as_wrong_password():
    from gita_api.security.auth import verify_password

    assert verify_password("anything", "not-a-real-hash") is False


# --- Registration and sign-in ---------------------------------------------


def test_register_then_sign_in(client):
    email = f"test-{uuid.uuid4().hex[:12]}@example.com"
    password = "a-long-enough-password"

    created = client.post("/v1/auth/register", json={"email": email, "password": password})
    assert created.status_code == 201
    assert created.json()["accessToken"]

    # The same address cannot be registered twice.
    assert (
        client.post("/v1/auth/register", json={"email": email, "password": password}).status_code
        == 409
    )

    assert (
        client.post("/v1/auth/login", json={"email": email, "password": password}).status_code
        == 200
    )
    assert (
        client.post("/v1/auth/login", json={"email": email, "password": "wrong"}).status_code == 401
    )
    assert (
        client.post(
            "/v1/auth/login", json={"email": "nobody@example.com", "password": password}
        ).status_code
        == 401
    )


def test_refresh_token_cannot_be_swapped_for_an_access_token(client, account):
    email = f"test-{uuid.uuid4().hex[:12]}@example.com"
    created = client.post(
        "/v1/auth/register", json={"email": email, "password": "a-long-enough-password"}
    ).json()

    assert (
        client.post("/v1/auth/refresh", json={"refreshToken": created["refreshToken"]}).status_code
        == 200
    )
    # An access token is not a refresh token, and must not be accepted as one.
    assert (
        client.post("/v1/auth/refresh", json={"refreshToken": created["accessToken"]}).status_code
        == 401
    )


def test_new_account_gets_its_default_collections(client, account):
    auth = account()
    changes = client.get("/v1/sync/pull", headers=auth).json()["changes"]
    names = sorted(c["payload"]["name"] for c in changes if c["entity"] == "collections")
    assert names == ["Favorites", "Memorize"]


# --- Sync -----------------------------------------------------------------


def _push(client, auth, changes):
    return client.post(
        "/v1/sync/push",
        headers=auth,
        json={"deviceId": str(uuid.uuid4()), "since": None, "changes": changes},
    )


def _change(entity, client_id, payload, *, revision=1, deleted=False):
    return {
        "entity": entity,
        "clientId": client_id,
        "revision": revision,
        "updatedAt": _now(),
        "deleted": deleted,
        "payload": payload,
    }


def test_pull_succeeds_for_every_entity(client, account):
    """Regression: pull raised AttributeError on `CollectionItem.user_id`."""
    auth = account()
    response = client.get("/v1/sync/pull", headers=auth)
    assert response.status_code == 200, response.text


def test_offline_created_record_keeps_its_id(client, account):
    auth = account()
    verse_id = client.get("/v1/verses/2/47").json()["id"]
    bookmark_id = str(uuid.uuid4())

    response = _push(client, auth, [_change("bookmarks", bookmark_id, {"verse_id": verse_id})])
    assert response.json()["accepted"] == [bookmark_id]

    pulled = {c["clientId"] for c in client.get("/v1/sync/pull", headers=auth).json()["changes"]}
    assert bookmark_id in pulled


def test_stale_revision_conflicts_and_returns_server_state(client, account):
    auth = account()
    verse_id = client.get("/v1/verses/2/47").json()["id"]
    bookmark_id = str(uuid.uuid4())

    _push(
        client, auth, [_change("bookmarks", bookmark_id, {"verse_id": verse_id, "note": "first"})]
    )
    response = _push(
        client, auth, [_change("bookmarks", bookmark_id, {"verse_id": verse_id, "note": "stale"})]
    )

    conflicts = response.json()["conflicts"]
    assert len(conflicts) == 1
    assert conflicts[0]["reason"] == "stale_revision"
    # The client needs the authoritative state to reconcile without a refetch.
    assert conflicts[0]["serverState"] is not None

    ahead = _push(
        client,
        auth,
        [_change("bookmarks", bookmark_id, {"verse_id": verse_id, "note": "newer"}, revision=2)],
    )
    assert ahead.json()["accepted"] == [bookmark_id]


def test_deletion_travels_as_a_tombstone(client, account):
    auth = account()
    verse_id = client.get("/v1/verses/2/47").json()["id"]
    bookmark_id = str(uuid.uuid4())

    _push(client, auth, [_change("bookmarks", bookmark_id, {"verse_id": verse_id})])
    _push(
        client,
        auth,
        [_change("bookmarks", bookmark_id, {"verse_id": verse_id}, revision=2, deleted=True)],
    )

    pulled = client.get("/v1/sync/pull", headers=auth).json()["changes"]
    tombstone = [c for c in pulled if c["clientId"] == bookmark_id]
    # A delete has to reach other devices, so it is a tombstone, not a DELETE.
    assert tombstone and tombstone[0]["deleted"] is True


def test_one_account_cannot_write_another_accounts_row(client, account):
    alice, bob = account(), account()
    verse_id = client.get("/v1/verses/2/47").json()["id"]
    note_id = str(uuid.uuid4())

    _push(
        client, alice, [_change("notes", note_id, {"verse_id": verse_id, "body": "alice's note"})]
    )

    hijack = _push(
        client,
        bob,
        [_change("notes", note_id, {"verse_id": verse_id, "body": "hijacked"}, revision=99)],
    )
    assert hijack.json()["accepted"] == []
    assert hijack.json()["conflicts"][0]["reason"] == "validation_failed"

    mine = [
        c
        for c in client.get("/v1/sync/pull", headers=alice).json()["changes"]
        if c["clientId"] == note_id
    ]
    assert mine[0]["payload"]["body"] == "alice's note"


def test_collection_items_are_scoped_by_their_parent_collection(client, account):
    """Regression: a collection item has no `user_id`, and the ownership check
    read a missing one as permission to write."""
    alice, bob = account(), account()
    verse_id = client.get("/v1/verses/2/47").json()["id"]

    alice_collection = next(
        c["clientId"]
        for c in client.get("/v1/sync/pull", headers=alice).json()["changes"]
        if c["entity"] == "collections"
    )

    item_id = str(uuid.uuid4())
    owned = _push(
        client,
        alice,
        [
            _change(
                "collection_items",
                item_id,
                {"collection_id": alice_collection, "verse_id": verse_id},
            )
        ],
    )
    assert owned.json()["accepted"] == [item_id]

    # Bob cannot add to Alice's collection...
    intruder = _push(
        client,
        bob,
        [
            _change(
                "collection_items",
                str(uuid.uuid4()),
                {"collection_id": alice_collection, "verse_id": verse_id},
            )
        ],
    )
    assert intruder.json()["accepted"] == []

    # ...nor overwrite an item already in it.
    overwrite = _push(
        client,
        bob,
        [
            _change(
                "collection_items",
                item_id,
                {"collection_id": alice_collection, "verse_id": verse_id},
                revision=99,
                deleted=True,
            )
        ],
    )
    assert overwrite.json()["accepted"] == []

    bob_items = [
        c
        for c in client.get("/v1/sync/pull", headers=bob).json()["changes"]
        if c["entity"] == "collection_items"
    ]
    assert bob_items == []


def test_a_client_cannot_forge_ownership_or_revision(client, account):
    auth = account()
    verse_id = client.get("/v1/verses/2/47").json()["id"]
    note_id = str(uuid.uuid4())

    _push(
        client,
        auth,
        [
            _change(
                "notes",
                note_id,
                {
                    "verse_id": verse_id,
                    "body": "x",
                    # Neither of these is a writable column.
                    "user_id": str(uuid.uuid4()),
                    "revision": 999,
                },
            )
        ],
    )

    pulled = [
        c
        for c in client.get("/v1/sync/pull", headers=auth).json()["changes"]
        if c["clientId"] == note_id
    ]
    assert len(pulled) == 1, "the row must belong to the caller, not the forged user"
    assert pulled[0]["revision"] == 1, "the revision comes from the envelope, not the payload"


def test_incremental_pull_respects_the_cursor(client, account):
    auth = account()
    future = (datetime.now(UTC) + timedelta(minutes=5)).isoformat()
    assert (
        client.get("/v1/sync/pull", headers=auth, params={"since": future}).json()["changes"] == []
    )

    past = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    assert client.get("/v1/sync/pull", headers=auth, params={"since": past}).json()["changes"]


# --- The write guard ------------------------------------------------------


def test_write_guard_is_active_without_the_web_lifespan():
    """Regression: the guard was installed from the FastAPI lifespan, so every
    CLI script — the importer, the reindexer — ran unguarded.

    This test deliberately does not use the `client` fixture, so no lifespan
    runs. It is the situation a script is in.
    """
    from gita_api.db.models import Verse
    from gita_api.db.session import session_scope
    from gita_api.security.content_guard import CanonicalWriteError, ai_actor

    with session_scope() as db:
        verse = db.query(Verse).first()
        if verse is None:
            pytest.skip("no verses imported")
        original = verse.speaker

        with pytest.raises(CanonicalWriteError), ai_actor():
            verse.speaker = "written by a model"
            db.flush()
        db.rollback()

    with session_scope() as db:
        assert db.query(Verse).first().speaker == original


def test_the_same_write_is_allowed_outside_the_ai_context():
    """The guard must block the AI path only — editors still need to work."""
    from gita_api.db.models import Verse
    from gita_api.db.session import session_scope
    from gita_api.security.content_guard import CanonicalWriteError

    with session_scope() as db:
        verse = db.query(Verse).first()
        if verse is None:
            pytest.skip("no verses imported")
        try:
            verse.speaker = verse.speaker
            db.flush()
        except CanonicalWriteError:
            pytest.fail("the guard fired outside the AI context")
        db.rollback()
