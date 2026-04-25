# Database Testing

API Workbench allows you to integrate database queries directly into your testing flows. This is useful for verifying side effects, fetching one-time passwords (OTPs), or cleaning up test data.

## Configuration

To use databases in your flows, you must first define a connection profile:

1. Click the **Settings** icon (gear) in the title bar.
2. Navigate to the **Databases** tab.
3. Click **Add Connection**.
4. Configure your connection:
   - **Type**: Currently supports **Redis**. (PostgreSQL and MySQL coming soon).
   - **Host/Port**: The address of your database server.
   - **Credentials**: User and password if required.
   - **Database**: For Redis, this is the database index (default: 0).
5. Click **Test Connection** to verify settings.

## Using DB Query in Flows

1. Open a **Flow** tab.
2. From the **Add node** palette, select **DB Query**.
3. Select your configured connection from the dropdown.
4. Enter your **Query**:
   - For Redis, you can enter any standard command (e.g., `GET mykey`, `HGET user:1 profile`).
   - You can use variables in the query using `{{variableName}}` syntax.
5. (Optional) Enter a **Variable name** to store the result.

### Example: Extracting an OTP

If your application sends an OTP to Redis, you can fetch it and use it in a subsequent login request:

1. **Request Node**: Trigger the "Send OTP" API.
2. **DB Query Node**: 
   - Query: `GET otp:{{email}}`
   - Store in: `extractedOtp`
3. **Request Node**: Call "Verify OTP" API using `{{extractedOtp}}` in the body.

## Variable Substitution

Results from database queries are stored as raw values or JSON objects (if applicable). You can access them in later nodes:
- In **Assert** nodes: `vars.dbResult === "expectedValue"`
- In **Request** nodes: `{{dbResult}}` in URL, Headers, or Body.
- In **Transform** nodes: `const val = vars.dbResult;`
