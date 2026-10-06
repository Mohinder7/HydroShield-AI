import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from openai import RateLimitError

from api_server import app


class SimulatedRateLimitError(RateLimitError):
    def __init__(self):
        Exception.__init__(self, "provider response details")


class FailingResponses:
    def __init__(self, error):
        self.error = error

    def create(self, **_kwargs):
        if not _kwargs:
            raise AssertionError("Expected assistant request options")
        raise self.error


class FailingOpenAIClient:
    def __init__(self, error):
        self.responses = FailingResponses(error)


class AssistantErrorTests(unittest.TestCase):
    def test_provider_rate_limit_returns_service_unavailable_without_details(self):
        client = FailingOpenAIClient(SimulatedRateLimitError())

        with patch("api_server.openai_client", client), TestClient(app) as test_client:
            response = test_client.post(
                "/api/assistant",
                json={"message": "Explain flood detection", "history": []},
            )

        self.assertEqual(response.status_code, 503)
        self.assertIn("quota or rate limit", response.json()["detail"])
        self.assertNotIn("provider response details", response.text)


if __name__ == "__main__":
    unittest.main()
