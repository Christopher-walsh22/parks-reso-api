const { dynamoClient, PutItemCommand, TABLE_NAME, sendResponse, logger, marshall } = require('/opt/baseLayer');

exports.handler = async (event, context) => {
  const permissionObject = event.requestContext.authorizer;
  permissionObject.roles = JSON.parse(permissionObject.roles);

  if (permissionObject.isAdmin !== true) {
    return sendResponse(403, { msg: 'Unauthorized' }, context);
  }
  let configObject = {
    TableName: TABLE_NAME
  };

  try {
    logger.debug(event.body);
    let newObject = JSON.parse(event.body);

    configObject.Item = {};
    configObject.Item['pk'] = { S: 'config' };
    configObject.Item['sk'] = { S: 'config' };
    configObject.Item['configData'] = { M: marshall(newObject) };

    logger.debug('putting item:', configObject);
    const command = new PutItemCommand(configObject)
    let res = dynamoClient.send(command);
    logger.debug('res:', res);
    return sendResponse(200, res);
  } catch (err) {
    logger.error('err', err);
    return sendResponse(400, err);
  }
};
