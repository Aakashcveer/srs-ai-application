"""
Common settings loader for SRS AI backend.

Actual values must be stored in AWS SSM Parameter Store / Secrets Manager.
This file only contains SSM path-building logic and loader helpers.

Base environment variables:
APP_NAME=srs-ai
APP_ENV=dev
"""

import os
from functools import lru_cache

import boto3


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


@lru_cache(maxsize=256)
def get_parameter(relative_path: str, default: str = "", with_decryption: bool = True) -> str:
    """
    Read a value from AWS SSM Parameter Store.

    relative_path example:
    aws/region

    Full path resolved:
    /srs-ai/dev/aws/region
    """
    parameter_name = build_path(relative_path)

    try:
        ssm = boto3.client("ssm")
        response = ssm.get_parameter(
            Name=parameter_name,
            WithDecryption=with_decryption,
        )
        return response["Parameter"]["Value"]
    except Exception:
        if default != "":
            return default
        raise


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
# ------------------------------------------------------------------
DOCS_STORE_BUCKET_NAME_PATH = build_path("docs-store/bucket-name")
DOCS_STORE_ENGR_DWGS_PREFIX_PATH = build_path("docs-store/prefix-engr-dwgs")
DOCS_STORE_SPLR_DOCS_PREFIX_PATH = build_path("docs-store/prefix-splr-docs")
DOCS_STORE_RGLT_DOCS_PREFIX_PATH = build_path("docs-store/prefix-rglt-docs")

# ------------------------------------------------------------------
# CREW STORE / DYNAMODB
# ------------------------------------------------------------------
CREW_STORE_CUSTOMER_REQUEST_PATH = build_path("crew-store/customer-request")
CREW_STORE_USER_CHAT_SESSION_PATH = build_path("crew-store/user-chat-session")
CREW_STORE_USER_TASK_PATH = build_path("crew-store/user-task")
CREW_STORE_WORKFLOW_LOG_PATH = build_path("crew-store/workflow-log")
CREW_STORE_COMPONENT_CATALOGUE_PATH = build_path("crew-store/component-catalogue")

# ------------------------------------------------------------------
# AGENT / AGENTCORE
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
# ------------------------------------------------------------------
SES_SENDER_EMAIL_PATH = build_path("ses/sender-email")
SES_REPLY_TO_EMAIL_PATH = build_path("ses/reply-to-email")

# ------------------------------------------------------------------
# EXTERNAL INTERFACE / SQL
# ------------------------------------------------------------------
SQL_CONNECTION_STRING_PATH = build_path("secrets/external-store/sql-connection-string")

# ------------------------------------------------------------------
# API KEYS / SECRETS
# ------------------------------------------------------------------
GEMINI_API_KEY_PATH = build_path("secrets/api/gemini")

# ------------------------------------------------------------------
# MODEL
# ------------------------------------------------------------------
MODEL_ID_PATH = build_path("model/id")
MODEL_PROVIDER_PATH = build_path("model/provider")


class Settings:
    """
    Runtime settings loaded from AWS SSM Parameter Store.

    Keep fallback defaults during migration so existing Lambda code
    does not break while we move values from env vars to SSM.
    """

    # AWS
    aws_region = get_parameter("aws/region", default="ap-south-1")

    # Cognito
    cognito_user_pool_id = get_parameter("cognito/user-pool-id", default="")
    cognito_client_id = get_parameter("cognito/client-id", default="")
    cognito_region = get_parameter("cognito/region", default=aws_region)

    # S3 / Docs Store
    docs_bucket = get_parameter("docs-store/bucket-name", default="")
    docs_engr_dwgs_prefix = get_parameter("docs-store/prefix-engr-dwgs", default="engineering-drawings/")
    docs_splr_docs_prefix = get_parameter("docs-store/prefix-splr-docs", default="supplier-docs/")
    docs_rglt_docs_prefix = get_parameter("docs-store/prefix-rglt-docs", default="regulatory-docs/")

    # DynamoDB / Crew Store
    customer_request_store = get_parameter(
        "crew-store/customer-request",
        default="srs-ai-dev-customer-request-store",
    )
    user_chat_session_store = get_parameter(
        "crew-store/user-chat-session",
        default="srs-ai-dev-user-chat-session-store",
    )
    user_task_store = get_parameter(
        "crew-store/user-task",
        default="srs-ai-dev-user-task-store",
    )
    workflow_log_store = get_parameter(
        "crew-store/workflow-log",
        default="srs-ai-dev-workflow-log-store",
    )
    component_catalogue_store = get_parameter(
        "crew-store/component-catalogue",
        default="srs-ai-dev-component-catalogue-store",
    )

    # AgentCore
    agentcore_runtime_arn = get_parameter("agent/agentcore/runtime-arn", default="")
    agentcore_qualifier = get_parameter("agent/agentcore/qualifier", default="DEFAULT")
    agent_aws_region = get_parameter("agent/aws_region", default=aws_region)
    agent_customer_request_table = get_parameter("agent/customer_request_table", default=customer_request_store)
    agent_workflow_log_table = get_parameter("agent/workflow_log_table", default=workflow_log_store)
    agent_model_id = get_parameter("agent/model_id", default="")
    agent_llm_bedrock_model = get_parameter("agent/llm/bedrock-model", default="")
    agent_llm_bedrock_region = get_parameter("agent/llm/bedrock-region", default=aws_region)

    # SES
    ses_sender_email = get_parameter("ses/sender-email", default="")
    ses_reply_to_email = get_parameter("ses/reply-to-email", default="")

    # SQL / RDS
    sql_connection_string = get_parameter(
        "secrets/external-store/sql-connection-string",
        default="",
        with_decryption=True,
    )

    # API Keys
    gemini_api_key = get_parameter(
        "secrets/api/gemini",
        default="",
        with_decryption=True,
    )

    # Model
    model_id = get_parameter("model/id", default="anthropic.claude-3-haiku-20240307-v1:0")
    model_provider = get_parameter("model/provider", default="bedrock")


settings = Settings()
