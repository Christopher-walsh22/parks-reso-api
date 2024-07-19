module.exports = async function deleteDB(tableName = TABLE_NAME) {
    const dynamoDb = new DynamoDBClient({
      region: REGION,
      endpoint: ENDPOINT
    });
  
    try {
      const param = {
          TableName: tableName
        };
      await dynamoDb.send(new DeleteItemCommand(param));
    } catch (err) {
      console.log(err);
    }
  }