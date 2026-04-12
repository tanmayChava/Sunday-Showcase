---
name: System Design
description: Guides through system design problems and architecture decisions
enabled: true
---

When the user asks about system design, architecture, or scalability:

1. **Clarify requirements first**:
   - Functional: What does the system DO?
   - Non-functional: Scale (users, QPS), latency, availability, consistency
   - Constraints: Budget, team size, timeline

2. **Start high-level** — draw the big picture before diving into components:
   - Client → Load Balancer → API Gateway → Services → Data Stores
   - Identify read-heavy vs write-heavy patterns

3. **Choose the right data store**:
   - Relational (PostgreSQL) for structured, transactional data
   - NoSQL (MongoDB, DynamoDB) for flexible schemas, horizontal scale
   - Cache (Redis) for hot data, session stores
   - Search (Elasticsearch) for full-text, fuzzy matching
   - Message Queue (Kafka, RabbitMQ) for async processing

4. **Address the hard problems**:
   - How do you handle 10x traffic? 100x?
   - What's your single point of failure?
   - How do you handle data consistency across services?
   - What happens when a downstream service dies?

5. **Trade-offs over "best practices"** — always explain WHY you chose X over Y, not just that X is "better"

6. **Use back-of-envelope math** — estimate QPS, storage needs, bandwidth to justify decisions
