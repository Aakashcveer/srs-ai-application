"""
Common settings loader for SRS AI backend.

Actual values must be stored in AWS SSM Parameter Store / Secrets Manager.
This file only contains SSM path-building logic and config path constants.

Base environment variables:
APP_NAME=srs-ai
APP_ENV=dev
"""

import os


APP_NAME = os.environ.get("APP_NAME", "srs-ai")
APP_ENV = os.environ.get("APP_ENV", "dev")

BASE_PATH = f"/{APP_NAME}/{APP_ENV}"


def build_path(relative_path: str) -> str:
    """
    Build full SSM Parameter Store path.

    Example:
    build_path("aws/region")
    -> /srs-ai/dev/aws/region
    """
    clean_path = relative_path.strip().strip("/")
    return f"{BASE_PATH}/{clean_path}"


# ------------------------------------------------------------------
# AWS
# ------------------------------------------------------------------
AWS_REGION_PATH = build_path("aws/region")

# ------------------------------------------------------------------
# COGNITO
# ------------------------------------------------------------------
COGNITO_USER_POOL_ID_PATH = build_path("cognito/user-pool-id")
COGNITO_CLIENT_ID_PATH = build_path("cognito/client-id")
COGNITO_REGION_PATH = build_path("cognito/region")

# ------------------------------------------------------------------
# DOCS STORE / S3
# Existing SSM paths from KC structure
# ------------------------------------------------------------------
DOCS_STORE_BUCKET_NAME_PATH = build_path("docs-store/bucket-name")
DOCS_STORE_ENGR_DWGS_PREFIX_PATH = build_path("docs-store/prefix-engr-dwgs")
DOCS_STORE_SPLR_DOCS_PREFIX_PATH = build_path("docs-store/prefix-splr-docs")
DOCS_STORE_RGLT_DOCS_PREFIX_PATH = build_path("docs-store/prefix-rglt-docs")

# ------------------------------------------------------------------
# CREW STORE / DYNAMODB
# Existing SSM paths from KC structure
# ------------------------------------------------------------------
CREW_STORE_CUSTOMER_REQUEST_PATH = build_path("crew-store/customer-request")
CREW_STORE_USER_CHAT_SESSION_PATH = build_path("crew-store/user-chat-session")
CREW_STORE_USER_TASK_PATH = build_path("crew-store/user-task")
CREW_STORE_WORKFLOW_LOG_PATH = build_path("crew-store/workflow-log")
CREW_STORE_COMPONENT_CATALOGUE_PATH = build_path("crew-store/component-catalogue")

# ------------------------------------------------------------------
# AGENT / AGENTCORE
# Existing SSM paths from KC structure
# ------------------------------------------------------------------
AGENTCORE_RUNTIME_ARN_PATH = build_path("agent/agentcore/runtime-arn")
AGENTCORE_QUALIFIER_PATH = build_path("agent/agentcore/qualifier")
AGENT_AWS_REGION_PATH = build_path("agent/aws_region")
AGENT_CUSTOMER_REQUEST_TABLE_PATH = build_path("agent/customer_request_table")
AGENT_WORKFLOW_LOG_TABLE_PATH = build_path("agent/workflow_log_table")
AGENT_MODEL_ID_PATH = build_path("agent/model_id")
AGENT_LLM_BEDROCK_MODEL_PATH = build_path("agent/llm/bedrock-model")
AGENT_LLM_BEDROCK_REGION_PATH = build_path("agent/llm/bedrock-region")

# ------------------------------------------------------------------
# SES
# These may need to be created if not already present
# ------------------------------------------------------------------
SES_SENDER_EMAIL_PATH = build_path("ses/sender-email")
SES_REPLY_TO_EMAIL_PATH = build_path("ses/reply-to-email")

# ------------------------------------------------------------------
# EXTERNAL INTERFACE / SQL
# Existing secure SSM path from KC structure
# ------------------------------------------------------------------
SQL_CONNECTION_STRING_PATH = build_path("secrets/external-store/sql-connection-string")

# ------------------------------------------------------------------
# API KEYS / SECRETS
# Existing secure SSM path from KC structure
# ------------------------------------------------------------------
GEMINI_API_KEY_PATH = build_path("secrets/api/gemini")

# ------------------------------------------------------------------
# MODEL
# General model path if needed later
# ------------------------------------------------------------------
MODEL_ID_PATH = build_path("model/id")
MODEL_PROVIDER_PATH = build_path("model/provider")
