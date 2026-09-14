# Sprint 1 - Member 3 Research

## 1. Overview
Research on AWS Cognito, DynamoDB, and AWS Lambda to support a 3-stage Multi-Factor Authentication (MFA) system. This document also outlines the proposed Caesar Cipher implementation approach.

---

## 2. AWS Cognito

### Purpose
AWS Cognito provides user authentication, authorization, and user management.

### Key Features
- User registration and login
- MFA support
- Password policies
- User groups and roles
- JWT token generation

### Project Usage
- Store user accounts
- Manage authentication workflow
- Trigger MFA challenges
- Generate secure access tokens

### Advantages
- Fully managed service
- Integrates with AWS Lambda
- Built-in MFA support
- Scalable and secure

---

## 3. Amazon DynamoDB

### Purpose
NoSQL database used to store authentication and user-related information.

### Proposed Tables

#### Users Table
| Attribute | Description |
|------------|------------|
| UserID | Unique user identifier |
| Username | User login name |
| Email | User email |
| MFAStatus | MFA enabled/disabled |

#### MFA Logs Table
| Attribute | Description |
|------------|------------|
| LogID | Unique log entry |
| UserID | User reference |
| Stage | Authentication stage |
| Timestamp | Event time |

### Advantages
- Serverless
- High availability
- Low latency
- Automatic scaling

---

## 4. AWS Lambda

### Purpose
Execute authentication logic without managing servers.

### Proposed Functions

#### Login Validation
- Verify credentials from Cognito

#### MFA Verification
- Validate MFA codes

#### Caesar Cipher Processing
- Encrypt and decrypt messages

#### Audit Logging
- Record authentication events in DynamoDB

### Benefits
- Event-driven
- Cost-effective
- Scalable
- Easy integration with Cognito

---

## 5. Three-Stage MFA Design

### Stage 1
Username and password verification using Cognito.

### Stage 2
One-Time Password (OTP) verification.

### Stage 3
Caesar Cipher challenge-response verification.

### Authentication Flow

1. User enters credentials.
2. Cognito validates identity.
3. OTP is generated and verified.
4. Caesar Cipher challenge is presented.
5. Lambda validates response.
6. Access granted.

---

## 6. Caesar Cipher Implementation

### Overview
Caesar Cipher is a substitution cipher that shifts letters by a fixed number.

### Example

Original:
HELLO

Shift: 3

Encrypted:
KHOOR

### Encryption Formula

Encrypted Character = (Character + Shift) mod 26

### Decryption Formula

Decrypted Character = (Character - Shift) mod 26

### Proposed Usage
- Generate random challenge strings.
- User decrypts or encrypts based on instructions.
- Lambda validates the response.

### Advantages
- Simple implementation
- Lightweight computation
- Suitable for educational MFA demonstration

### Limitations
- Not cryptographically secure
- Used only as an additional challenge mechanism

---

## 7. Integration Summary

| Service | Role |
|----------|------|
| Cognito | User Authentication |
| Lambda | Business Logic |
| DynamoDB | Data Storage |
| Caesar Cipher | Third Authentication Factor |

---

## 8. References

- AWS Cognito Documentation
- AWS Lambda Documentation
- Amazon DynamoDB Documentation