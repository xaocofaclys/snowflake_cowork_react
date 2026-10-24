-- =====================================================================
-- 04_demo_agent.sql (OPTIONAL): a simple text-to-SQL agent over TPC-H, for accounts without an agent.
-- Copies TPCH_SF1 sample data locally (avoids share privileges), builds a
-- semantic view, and creates an agent with Cortex Analyst + data_to_chart.
-- data_to_chart is what makes the agent emit `response.chart` events.
-- =====================================================================
USE ROLE ACCOUNTADMIN;
USE WAREHOUSE COWORK_WH;
ALTER WAREHOUSE COWORK_WH SET WAREHOUSE_SIZE = SMALL;  -- faster copy; reset below

CREATE OR REPLACE TABLE DEV_REACT_COWORK.TPCH.REGION   AS SELECT * FROM SNOWFLAKE_SAMPLE_DATA.TPCH_SF1.REGION;
CREATE OR REPLACE TABLE DEV_REACT_COWORK.TPCH.NATION   AS SELECT * FROM SNOWFLAKE_SAMPLE_DATA.TPCH_SF1.NATION;
CREATE OR REPLACE TABLE DEV_REACT_COWORK.TPCH.CUSTOMER AS SELECT * FROM SNOWFLAKE_SAMPLE_DATA.TPCH_SF1.CUSTOMER;
CREATE OR REPLACE TABLE DEV_REACT_COWORK.TPCH.ORDERS   AS SELECT * FROM SNOWFLAKE_SAMPLE_DATA.TPCH_SF1.ORDERS;
CREATE OR REPLACE TABLE DEV_REACT_COWORK.TPCH.LINEITEM AS SELECT * FROM SNOWFLAKE_SAMPLE_DATA.TPCH_SF1.LINEITEM;
ALTER WAREHOUSE COWORK_WH SET WAREHOUSE_SIZE = XSMALL;

CREATE OR REPLACE SEMANTIC VIEW DEV_REACT_COWORK.ANALYTICS.TPCH_SALES
  TABLES (
    orders AS DEV_REACT_COWORK.TPCH.ORDERS PRIMARY KEY (O_ORDERKEY)
      WITH SYNONYMS ('sales', 'purchases') COMMENT = 'One row per customer order',
    lineitem AS DEV_REACT_COWORK.TPCH.LINEITEM PRIMARY KEY (L_ORDERKEY, L_LINENUMBER)
      COMMENT = 'Order lines; revenue lives here',
    customer AS DEV_REACT_COWORK.TPCH.CUSTOMER PRIMARY KEY (C_CUSTKEY),
    nation AS DEV_REACT_COWORK.TPCH.NATION PRIMARY KEY (N_NATIONKEY),
    region AS DEV_REACT_COWORK.TPCH.REGION PRIMARY KEY (R_REGIONKEY)
  )
  RELATIONSHIPS (
    lineitem_to_orders AS lineitem (L_ORDERKEY) REFERENCES orders,
    orders_to_customer AS orders (O_CUSTKEY) REFERENCES customer,
    customer_to_nation AS customer (C_NATIONKEY) REFERENCES nation,
    nation_to_region AS nation (N_REGIONKEY) REFERENCES region
  )
  FACTS (
    lineitem.net_revenue AS L_EXTENDEDPRICE * (1 - L_DISCOUNT) COMMENT = 'Revenue after discount',
    lineitem.quantity AS L_QUANTITY,
    orders.order_total AS O_TOTALPRICE
  )
  DIMENSIONS (
    orders.order_date AS O_ORDERDATE,
    orders.order_month AS DATE_TRUNC('MONTH', O_ORDERDATE),
    orders.order_year AS YEAR(O_ORDERDATE),
    orders.order_status AS O_ORDERSTATUS,
    orders.order_priority AS O_ORDERPRIORITY,
    customer.customer_name AS C_NAME,
    customer.market_segment AS C_MKTSEGMENT WITH SYNONYMS ('segment'),
    nation.nation_name AS N_NAME WITH SYNONYMS ('country'),
    region.region_name AS R_NAME WITH SYNONYMS ('region')
  )
  METRICS (
    lineitem.revenue AS SUM(lineitem.net_revenue) COMMENT = 'Net revenue',
    lineitem.units AS SUM(lineitem.quantity),
    orders.order_count AS COUNT(orders.O_ORDERKEY),
    orders.avg_order_value AS AVG(orders.order_total)
  )
  COMMENT = 'TPC-H sales: orders, revenue, customers, geography';

CREATE OR REPLACE AGENT DEV_REACT_COWORK.AGENTS.SALES_ANALYST
  COMMENT = 'Text-to-SQL over TPC-H orders, customers and regions'
  PROFILE = '{"display_name": "Sales Analyst"}'
  FROM SPECIFICATION
  $$
  models:
    orchestration: auto
  orchestration:
    budget:
      seconds: 90
      tokens: 32000
  instructions:
    orchestration: >
      Use the tpch_analyst tool for any question about orders, revenue, customers, nations or regions.
      Whenever the result has two or more rows and at least one numeric measure, ALSO call data_to_chart
      to visualize it. Prefer line charts for time series and bar charts for category comparisons.
      If a <user_context> block is present, honor the user's stated preferences (e.g. chart types, units).
    response: >
      Be concise. Lead with the answer in one or two sentences, then key figures. Format currency compactly ($2.6B).
      Do not repeat the full table in text.
    sample_questions:
      - question: "Show monthly revenue for 1997"
      - question: "Revenue by region"
      - question: "Top 10 customers by spend"
      - question: "Average order value by market segment"
  tools:
    - tool_spec:
        type: "cortex_analyst_text_to_sql"
        name: "tpch_analyst"
        description: "Answers quantitative questions about TPC-H sales by generating and running SQL."
    - tool_spec:
        type: "data_to_chart"
        name: "data_to_chart"
        description: "Generates a chart from query results."
  tool_resources:
    tpch_analyst:
      semantic_view: "DEV_REACT_COWORK.ANALYTICS.TPCH_SALES"
      execution_environment:
        type: "warehouse"
        warehouse: "COWORK_WH"
  $$;

-- End-user access.
GRANT SELECT ON ALL TABLES IN SCHEMA DEV_REACT_COWORK.TPCH TO ROLE COWORK_USER;
GRANT SELECT ON SEMANTIC VIEW DEV_REACT_COWORK.ANALYTICS.TPCH_SALES TO ROLE COWORK_USER;
GRANT USAGE ON AGENT DEV_REACT_COWORK.AGENTS.SALES_ANALYST TO ROLE COWORK_USER;

-- Smoke test in Snowsight: AI & ML > Agents > SALES_ANALYST, or set AGENT_LOCATIONS=DEV_REACT_COWORK.AGENTS.
