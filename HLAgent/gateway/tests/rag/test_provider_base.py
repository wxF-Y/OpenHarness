"""EmbedProvider protocol + profile id generation."""
import re

from services.rag.providers.base import gen_profile_id, ProviderConfig


def test_gen_profile_id_format():
    pid = gen_profile_id("openai")
    assert re.match(r"^emb_openai_[0-9a-f]{6}$", pid), pid


def test_gen_profile_id_unique_enough():
    ids = {gen_profile_id("openai") for _ in range(100)}
    assert len(ids) == 100


def test_provider_config_round_trip():
    cfg = ProviderConfig(
        id="emb_openai_abc123",
        name="default",
        provider="openai",
        model="text-embedding-3-small",
        dimensions=1536,
    )
    assert cfg.id == "emb_openai_abc123"
    assert cfg.dimensions == 1536
