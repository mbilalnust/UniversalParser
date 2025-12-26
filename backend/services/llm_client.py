from __future__ import annotations

import json
import urllib.request

import boto3  # type: ignore

from config import LLMConfig


class LLMError(RuntimeError):
    pass


def llm_to_markdown(text: str, filename: str, content_type: str, config: LLMConfig) -> str:
    if not config.enabled:
        raise LLMError("LLM is disabled. Set UP_LLM_ENABLED=true and configure provider settings.")
    if config.provider == "openai_compatible":
        return _openai_compatible(text, filename, content_type, config)
    if config.provider == "bedrock":
        return _bedrock(text, filename, content_type, config)
    raise LLMError(f"Unknown LLM provider: {config.provider}")


def _openai_compatible(text: str, filename: str, content_type: str, config: LLMConfig) -> str:
    model = config.model or "default"
    prompt = _format_prompt(text, filename, content_type)
    base = config.base_url.rstrip("/")
    if not base.endswith("/v1"):
        base = f"{base}/v1"
    url = f"{base}/chat/completions"

    payload = {
        "model": model,
        "temperature": config.temperature,
        "max_tokens": config.max_output_tokens,
        "messages": [
            {"role": "system", "content": "Convert the document content into clean markdown."},
            {"role": "user", "content": prompt},
        ],
    }
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, method="POST")
    request.add_header("Content-Type", "application/json")
    if config.api_key:
        request.add_header("Authorization", f"Bearer {config.api_key}")

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
    except Exception as exc:
        raise LLMError(f"Failed to call LLM provider: {exc}") from exc

    parsed = json.loads(raw.decode("utf-8"))
    try:
        return parsed["choices"][0]["message"]["content"].strip()
    except Exception as exc:  # pragma: no cover - defensive
        raise LLMError(f"Unexpected LLM response: {parsed}") from exc


def _bedrock(text: str, filename: str, content_type: str, config: LLMConfig) -> str:
    model = config.model
    if not model:
        raise LLMError("UP_LLM_MODEL must be set for Bedrock provider.")

    prompt = _format_prompt(text, filename, content_type)
    client = boto3.client("bedrock-runtime")
    body = json.dumps(
        {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": config.max_output_tokens,
            "temperature": config.temperature,
            "messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}],
        }
    )
    try:
        response = client.invoke_model(modelId=model, body=body)
    except Exception as exc:
        raise LLMError(f"Bedrock invocation failed: {exc}") from exc

    payload = json.loads(response["body"].read())
    try:
        return payload["content"][0]["text"].strip()
    except Exception as exc:  # pragma: no cover - defensive
        raise LLMError(f"Unexpected Bedrock response: {payload}") from exc


def _format_prompt(text: str, filename: str, content_type: str) -> str:
    return (
        f"Filename: {filename}\n"
        f"Content-Type: {content_type}\n"
        "Content:\n"
        f"{text}"
    )
