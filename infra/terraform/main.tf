terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
    }
    archive = {
      source = "hashicorp/archive"
    }
  }
}

provider "aws" {
  region = "us-east-2"
}

variable "enable_seed_data" {
  description = "Whether to seed default flight and seat data into DynamoDB."
  type        = bool
  default     = true
}

variable "seed_overwrite_available_seats" {
  description = "Whether seed script should overwrite availableSeats on existing flights."
  type        = bool
  default     = false
}

resource "aws_dynamodb_table" "flights" {
  name         = "airline-flights"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "route"
    type = "S"
  }

  global_secondary_index {
    name            = "route-date-index"
    projection_type = "ALL"
    hash_key        = "route"
  }

  tags = {
    Project = "airline-serverless-app"
  }
}

resource "aws_dynamodb_table" "seats" {
  name         = "airline-seats"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "flightId"
  range_key    = "seatNumber"

  attribute {
    name = "flightId"
    type = "S"
  }

  attribute {
    name = "seatNumber"
    type = "S"
  }

  tags = {
    Project = "airline-serverless-app"
  }
}

resource "aws_dynamodb_table" "users" {
  name         = "airline-users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "email"
    type = "S"
  }

  global_secondary_index {
    name            = "email-index"
    projection_type = "ALL"
    hash_key        = "email"
  }

  tags = {
    Project = "airline-serverless-app"
  }
}

resource "aws_dynamodb_table" "bookings" {
  name         = "airline-bookings"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "userId"
    type = "S"
  }

  global_secondary_index {
    name            = "userId-index"
    projection_type = "ALL"
    hash_key        = "userId"
  }

  tags = {
    Project = "airline-serverless-app"
  }
}

locals {
  seed_flights = {
    "FL-1001" = {
      from          = "ORD"
      to            = "JFK"
      date          = "2026-04-10"
      departureTime = "08:30"
      arrivalTime   = "11:20"
      price         = 220
      totalSeats    = 24
    }
    "FL-1002" = {
      from          = "SFO"
      to            = "LAX"
      date          = "2026-04-10"
      departureTime = "09:00"
      arrivalTime   = "10:35"
      price         = 140
      totalSeats    = 24
    }
    "FL-1003" = {
      from          = "SEA"
      to            = "DEN"
      date          = "2026-04-11"
      departureTime = "14:15"
      arrivalTime   = "17:05"
      price         = 180
      totalSeats    = 24
    }
  }

  seat_letters = ["A", "B", "C", "D", "E", "F"]

  seed_seats = flatten(flatten([
    for flight_id, _flight in local.seed_flights : [
      for row in range(1, 5) : [
        for letter in local.seat_letters : {
          key        = "${flight_id}#${row}${letter}"
          flightId   = flight_id
          seatNumber = "${row}${letter}"
          status     = "available"
        }
      ]
    ]
  ]))
}

resource "terraform_data" "seed_dynamodb" {
  count = var.enable_seed_data ? 1 : 0

  triggers_replace = [
    aws_dynamodb_table.flights.name,
    aws_dynamodb_table.seats.name,
  ]

  provisioner "local-exec" {
    command = <<-EOT
      if [ "${var.seed_overwrite_available_seats}" = "true" ]; then
        aws dynamodb put-item --region us-east-2 --table-name ${aws_dynamodb_table.flights.name} --item '{"id":{"S":"FL-1001"},"from":{"S":"ORD"},"to":{"S":"JFK"},"date":{"S":"2026-04-10"},"departureTime":{"S":"08:30"},"arrivalTime":{"S":"11:20"},"price":{"N":"220"},"totalSeats":{"N":"24"},"availableSeats":{"N":"24"},"route":{"S":"ORD#JFK"}}'
        aws dynamodb put-item --region us-east-2 --table-name ${aws_dynamodb_table.flights.name} --item '{"id":{"S":"FL-1002"},"from":{"S":"SFO"},"to":{"S":"LAX"},"date":{"S":"2026-04-10"},"departureTime":{"S":"09:00"},"arrivalTime":{"S":"10:35"},"price":{"N":"140"},"totalSeats":{"N":"24"},"availableSeats":{"N":"24"},"route":{"S":"SFO#LAX"}}'
        aws dynamodb put-item --region us-east-2 --table-name ${aws_dynamodb_table.flights.name} --item '{"id":{"S":"FL-1003"},"from":{"S":"SEA"},"to":{"S":"DEN"},"date":{"S":"2026-04-11"},"departureTime":{"S":"14:15"},"arrivalTime":{"S":"17:05"},"price":{"N":"180"},"totalSeats":{"N":"24"},"availableSeats":{"N":"24"},"route":{"S":"SEA#DEN"}}'
      else
        aws dynamodb update-item --region us-east-2 --table-name ${aws_dynamodb_table.flights.name} --key '{"id":{"S":"FL-1001"}}' --update-expression 'SET #f=:f,#t=:t,#d=:d,#dep=:dep,#arr=:arr,#p=:p,#ts=:ts,#r=:r,#av=if_not_exists(#av,:av)' --expression-attribute-names '{"#f":"from","#t":"to","#d":"date","#dep":"departureTime","#arr":"arrivalTime","#p":"price","#ts":"totalSeats","#r":"route","#av":"availableSeats"}' --expression-attribute-values '{":f":{"S":"ORD"},":t":{"S":"JFK"},":d":{"S":"2026-04-10"},":dep":{"S":"08:30"},":arr":{"S":"11:20"},":p":{"N":"220"},":ts":{"N":"24"},":r":{"S":"ORD#JFK"},":av":{"N":"24"}}'
        aws dynamodb update-item --region us-east-2 --table-name ${aws_dynamodb_table.flights.name} --key '{"id":{"S":"FL-1002"}}' --update-expression 'SET #f=:f,#t=:t,#d=:d,#dep=:dep,#arr=:arr,#p=:p,#ts=:ts,#r=:r,#av=if_not_exists(#av,:av)' --expression-attribute-names '{"#f":"from","#t":"to","#d":"date","#dep":"departureTime","#arr":"arrivalTime","#p":"price","#ts":"totalSeats","#r":"route","#av":"availableSeats"}' --expression-attribute-values '{":f":{"S":"SFO"},":t":{"S":"LAX"},":d":{"S":"2026-04-10"},":dep":{"S":"09:00"},":arr":{"S":"10:35"},":p":{"N":"140"},":ts":{"N":"24"},":r":{"S":"SFO#LAX"},":av":{"N":"24"}}'
        aws dynamodb update-item --region us-east-2 --table-name ${aws_dynamodb_table.flights.name} --key '{"id":{"S":"FL-1003"}}' --update-expression 'SET #f=:f,#t=:t,#d=:d,#dep=:dep,#arr=:arr,#p=:p,#ts=:ts,#r=:r,#av=if_not_exists(#av,:av)' --expression-attribute-names '{"#f":"from","#t":"to","#d":"date","#dep":"departureTime","#arr":"arrivalTime","#p":"price","#ts":"totalSeats","#r":"route","#av":"availableSeats"}' --expression-attribute-values '{":f":{"S":"SEA"},":t":{"S":"DEN"},":d":{"S":"2026-04-11"},":dep":{"S":"14:15"},":arr":{"S":"17:05"},":p":{"N":"180"},":ts":{"N":"24"},":r":{"S":"SEA#DEN"},":av":{"N":"24"}}'
      fi
      for flight in FL-1001 FL-1002 FL-1003; do
        for row in 1 2 3 4; do
          for letter in A B C D E F; do
            seat="$${row}$${letter}"
            aws dynamodb put-item --region us-east-2 --table-name ${aws_dynamodb_table.seats.name} --item "{\"flightId\":{\"S\":\"$${flight}\"},\"seatNumber\":{\"S\":\"$${seat}\"},\"status\":{\"S\":\"available\"}}"
          done
        done
      done
    EOT
  }
}

output "flights_table_name" {
  value = aws_dynamodb_table.flights.name
}

output "seats_table_name" {
  value = aws_dynamodb_table.seats.name
}

output "bookings_table_name" {
  value = aws_dynamodb_table.bookings.name
}

output "users_table_name" {
  value = aws_dynamodb_table.users.name
}

resource "aws_iam_role" "lambda_exec" {
  name = "airline-lambda-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_dynamodb" {
  name = "airline-lambda-dynamodb-access"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:TransactWriteItems"
        ]
        Resource = [
          aws_dynamodb_table.flights.arn,
          aws_dynamodb_table.seats.arn,
          aws_dynamodb_table.bookings.arn,
          aws_dynamodb_table.users.arn,
          "${aws_dynamodb_table.flights.arn}/index/*",
          "${aws_dynamodb_table.bookings.arn}/index/*",
          "${aws_dynamodb_table.users.arn}/index/*"
        ]
      }
    ]
  })
}

data "archive_file" "search_flights_zip" {
  type        = "zip"
  source_dir  = "../../lambdas/searchflights"
  output_path = "${path.module}/searchflights.zip"
}

resource "aws_lambda_function" "search_flights" {
  function_name    = "airline-search-flights"
  filename         = data.archive_file.search_flights_zip.output_path
  source_code_hash = data.archive_file.search_flights_zip.output_base64sha256
  role             = aws_iam_role.lambda_exec.arn
  handler          = "index.handler"
  runtime          = "nodejs18.x"
  timeout          = 10

  environment {
    variables = {
      FLIGHTS_TABLE = aws_dynamodb_table.flights.name
      SEATS_TABLE   = aws_dynamodb_table.seats.name
      BOOKINGS_TABLE = aws_dynamodb_table.bookings.name
    }
  }
}

data "archive_file" "flight_seats_zip" {
  type        = "zip"
  source_dir  = "../../lambdas/flightseats"
  output_path = "${path.module}/flightseats.zip"
}

resource "aws_lambda_function" "flight_seats" {
  function_name    = "airline-flight-seats"
  filename         = data.archive_file.flight_seats_zip.output_path
  source_code_hash = data.archive_file.flight_seats_zip.output_base64sha256
  role             = aws_iam_role.lambda_exec.arn
  handler          = "index.handler"
  runtime          = "nodejs18.x"
  timeout          = 10

  environment {
    variables = {
      FLIGHTS_TABLE = aws_dynamodb_table.flights.name
      SEATS_TABLE   = aws_dynamodb_table.seats.name
      BOOKINGS_TABLE = aws_dynamodb_table.bookings.name
    }
  }
}

data "archive_file" "create_booking_zip" {
  type        = "zip"
  source_dir  = "../../lambdas/createbooking"
  output_path = "${path.module}/createbooking.zip"
}

resource "aws_lambda_function" "create_booking" {
  function_name    = "airline-create-booking"
  filename         = data.archive_file.create_booking_zip.output_path
  source_code_hash = data.archive_file.create_booking_zip.output_base64sha256
  role             = aws_iam_role.lambda_exec.arn
  handler          = "index.handler"
  runtime          = "nodejs18.x"
  timeout          = 10

  environment {
    variables = {
      FLIGHTS_TABLE = aws_dynamodb_table.flights.name
      SEATS_TABLE   = aws_dynamodb_table.seats.name
      BOOKINGS_TABLE = aws_dynamodb_table.bookings.name
    }
  }
}

data "archive_file" "get_booking_zip" {
  type        = "zip"
  source_dir  = "../../lambdas/getbooking"
  output_path = "${path.module}/getbooking.zip"
}

resource "aws_lambda_function" "get_booking" {
  function_name    = "airline-get-booking"
  filename         = data.archive_file.get_booking_zip.output_path
  source_code_hash = data.archive_file.get_booking_zip.output_base64sha256
  role             = aws_iam_role.lambda_exec.arn
  handler          = "index.handler"
  runtime          = "nodejs18.x"
  timeout          = 10

  environment {
    variables = {
      FLIGHTS_TABLE = aws_dynamodb_table.flights.name
      SEATS_TABLE   = aws_dynamodb_table.seats.name
      BOOKINGS_TABLE = aws_dynamodb_table.bookings.name
    }
  }
}

data "archive_file" "manage_flight_zip" {
  type        = "zip"
  source_dir  = "../../lambdas/manageflight"
  output_path = "${path.module}/manageflight.zip"
}

resource "aws_lambda_function" "manage_flight" {
  function_name    = "airline-manage-flight"
  filename         = data.archive_file.manage_flight_zip.output_path
  source_code_hash = data.archive_file.manage_flight_zip.output_base64sha256
  role             = aws_iam_role.lambda_exec.arn
  handler          = "index.handler"
  runtime          = "nodejs18.x"
  timeout          = 10

  environment {
    variables = {
      FLIGHTS_TABLE  = aws_dynamodb_table.flights.name
      SEATS_TABLE    = aws_dynamodb_table.seats.name
      BOOKINGS_TABLE = aws_dynamodb_table.bookings.name
    }
  }
}

resource "aws_apigatewayv2_api" "airline_http_api" {
  name          = "airline-http-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
    allow_headers = ["content-type", "authorization"]
  }
}

resource "aws_apigatewayv2_integration" "search_flights" {
  api_id                 = aws_apigatewayv2_api.airline_http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.search_flights.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "flight_seats" {
  api_id                 = aws_apigatewayv2_api.airline_http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.flight_seats.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "create_booking" {
  api_id                 = aws_apigatewayv2_api.airline_http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.create_booking.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "get_booking" {
  api_id                 = aws_apigatewayv2_api.airline_http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.get_booking.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "manage_flight" {
  api_id                 = aws_apigatewayv2_api.airline_http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.manage_flight.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "search_flights" {
  api_id    = aws_apigatewayv2_api.airline_http_api.id
  route_key = "GET /api/flights"
  target    = "integrations/${aws_apigatewayv2_integration.search_flights.id}"
}

resource "aws_apigatewayv2_route" "flight_seats_get" {
  api_id    = aws_apigatewayv2_api.airline_http_api.id
  route_key = "GET /api/flights/{flightId}/seats"
  target    = "integrations/${aws_apigatewayv2_integration.flight_seats.id}"
}

resource "aws_apigatewayv2_route" "flight_seats_patch" {
  api_id    = aws_apigatewayv2_api.airline_http_api.id
  route_key = "PATCH /api/flights/{flightId}/seats"
  target    = "integrations/${aws_apigatewayv2_integration.flight_seats.id}"
}

resource "aws_apigatewayv2_route" "create_booking" {
  api_id    = aws_apigatewayv2_api.airline_http_api.id
  route_key = "POST /api/bookings"
  target    = "integrations/${aws_apigatewayv2_integration.create_booking.id}"
}

resource "aws_apigatewayv2_route" "get_booking" {
  api_id    = aws_apigatewayv2_api.airline_http_api.id
  route_key = "GET /api/bookings/{bookingId}"
  target    = "integrations/${aws_apigatewayv2_integration.get_booking.id}"
}

resource "aws_apigatewayv2_route" "manage_flight_patch" {
  api_id    = aws_apigatewayv2_api.airline_http_api.id
  route_key = "PATCH /api/flights/{flightId}"
  target    = "integrations/${aws_apigatewayv2_integration.manage_flight.id}"
}

resource "aws_apigatewayv2_route" "manage_flight_delete" {
  api_id    = aws_apigatewayv2_api.airline_http_api.id
  route_key = "DELETE /api/flights/{flightId}"
  target    = "integrations/${aws_apigatewayv2_integration.manage_flight.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.airline_http_api.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "allow_apigw_search_flights" {
  statement_id  = "AllowExecutionFromAPIGatewaySearchFlights"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.search_flights.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.airline_http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "allow_apigw_flight_seats" {
  statement_id  = "AllowExecutionFromAPIGatewayFlightSeats"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.flight_seats.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.airline_http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "allow_apigw_create_booking" {
  statement_id  = "AllowExecutionFromAPIGatewayCreateBooking"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.create_booking.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.airline_http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "allow_apigw_get_booking" {
  statement_id  = "AllowExecutionFromAPIGatewayGetBooking"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.get_booking.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.airline_http_api.execution_arn}/*/*"
}

resource "aws_lambda_permission" "allow_apigw_manage_flight" {
  statement_id  = "AllowExecutionFromAPIGatewayManageFlight"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.manage_flight.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.airline_http_api.execution_arn}/*/*"
}

output "api_gateway_url" {
  value = aws_apigatewayv2_api.airline_http_api.api_endpoint
}

# ── Bedrock Flight Assistant ─────────────────────────────────────────────────

resource "aws_secretsmanager_secret" "bedrock_config" {
  name        = "airline/bedrock-config"
  description = "AWS credentials and config for Bedrock inference"
}

resource "aws_iam_role_policy" "lambda_bedrock" {
  name = "airline-lambda-bedrock-access"
  role = aws_iam_role.lambda_exec.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel"]
        Resource = "arn:aws:bedrock:${var.bedrock_region}::foundation-model/amazon.titan-text-express-v1"
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.bedrock_config.arn
      }
    ]
  })
}

variable "bedrock_region" {
  description = "AWS region where Bedrock is available"
  type        = string
  default     = "us-east-1"
}

data "archive_file" "flight_assistant_zip" {
  type        = "zip"
  source_dir  = "../../lambdas/flightassistant"
  output_path = "${path.module}/flightassistant.zip"
}

resource "aws_lambda_function" "flight_assistant" {
  function_name    = "airline-flight-assistant"
  filename         = data.archive_file.flight_assistant_zip.output_path
  source_code_hash = data.archive_file.flight_assistant_zip.output_base64sha256
  role             = aws_iam_role.lambda_exec.arn
  handler          = "index.handler"
  runtime          = "nodejs18.x"
  timeout          = 30

  environment {
    variables = {
      FLIGHTS_TABLE       = aws_dynamodb_table.flights.name
      AWS_REGION_BEDROCK  = var.bedrock_region
    }
  }
}

resource "aws_apigatewayv2_integration" "flight_assistant" {
  api_id                 = aws_apigatewayv2_api.airline_http_api.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.flight_assistant.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "flight_assistant" {
  api_id    = aws_apigatewayv2_api.airline_http_api.id
  route_key = "POST /api/chat"
  target    = "integrations/${aws_apigatewayv2_integration.flight_assistant.id}"
}

resource "aws_lambda_permission" "allow_apigw_flight_assistant" {
  statement_id  = "AllowExecutionFromAPIGatewayFlightAssistant"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.flight_assistant.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.airline_http_api.execution_arn}/*/*"
}

output "flight_assistant_function_name" {
  value = aws_lambda_function.flight_assistant.function_name
}