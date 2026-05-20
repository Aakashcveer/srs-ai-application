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
# ------------------------------------------------------------------
S3_DOCS_BUCKET_PATH = build_path("s3/docs-bucket")
S3_DOCS_ENGR_DWGS_PREFIX_PATH = build_path("s3/docs-engr-dwgs-prefix")
S3_DOCS_SPLR_DOCS_PREFIX_PATH = build_path("s3/docs-splr-docs-prefix")
S3_DOCS_RGLT_DOCS_PREFIX_PATH = build_path("s3/docs-rglt-docs-prefix")

# ------------------------------------------------------------------
# CREW STORE / DYNAMODB
# ------------------------------------------------------------------
CREW_STORE_CUSTOMER_REQUEST_PATH = build_path("crew-store/customer-request")
CREW_STORE_USER_CHAT_SESSION_PATH = build_path("crew-store/user-chat-session")
CREW_STORE_USER_TASK_PATH = build_path("crew-store/user-task")
CREW_STORE_WORKFLOW_LOG_PATH = build_path("crew-store/workflow-log")
CREW_STORE_COMPONENT_CATALOGUE_PATH = build_path("crew-store/component-catalogue")

# ------------------------------------------------------------------
# LAMBDA / API
# ------------------------------------------------------------------
LAMBDA_CHAT_MANAGEMENT_NAME_PATH = build_path("lambda/chat-management-name")
API_BASE_URL_PATH = build_path("api/base-url")

# ------------------------------------------------------------------
# SES
# ------------------------------------------------------------------
SES_SENDER_EMAIL_PATH = build_path("ses/sender-email")
SES_REPLY_TO_EMAIL_PATH = build_path("ses/reply-to-email")

# ------------------------------------------------------------------
# EXTERNAL INTERFACE / SQL
# ------------------------------------------------------------------
SQL_CONNECTION_STRING_PATH = build_path("external-interface/sql/connection-string")

# ------------------------------------------------------------------
# AGENTCORE
# ------------------------------------------------------------------
AGENTCORE_RUNTIME_ARN_PATH = build_path("agentcore/runtime-arn")
AGENTCORE_QUALIFIER_PATH = build_path("agentcore/qualifier")

# ------------------------------------------------------------------
# MODEL
# ------------------------------------------------------------------
MODEL_ID_PATH = build_path("model/id")
MODEL_PROVIDER_PATH = build_path("model/provider")
