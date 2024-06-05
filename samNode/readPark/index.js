const AWS = require('aws-sdk');
const { runQuery, TABLE_NAME, visibleFilter, logger, sendResponse, checkWarmup } = require('/opt/baseLayer');
const { decodeJWT, roleFilter, resolvePermissions } = require('/opt/permissionLayer');


exports.handler = async (event, context) => {
  logger.info('Read Park', event);
  if (checkWarmup(event)) {
    return sendResponse(200, {});
  }

  let queryObj = {
    TableName: TABLE_NAME
  };

  try {
    console.log(event, "<-----EVENT")
    const permissionObject = event.requestContext.authorizer;
    permissionObject.role = JSON.parse(permissionObject.role);


    if (!event.queryStringParameters) {
      queryObj.ExpressionAttributeValues = {};
      queryObj.ExpressionAttributeValues[':pk'] = { S: 'park' };
      queryObj.KeyConditionExpression = 'pk =:pk';
    } else if (event.queryStringParameters.park) {
      // Get specific park.
      queryObj.ExpressionAttributeValues = {};
      queryObj.ExpressionAttributeValues[':pk'] = { S: 'park' };
      queryObj.ExpressionAttributeValues[':sk'] = { S: event.queryStringParameters.park };
      queryObj.KeyConditionExpression = 'pk =:pk AND sk =:sk';
    } else {
      logger.info('Invalid Request');
      return sendResponse(400, { msg: 'Invalid Request' }, context);
    }

    // Public
    if (!permissionObject.isAuthenticated) {
      logger.info("**NOT AUTHENTICATED, PUBLIC**")
      logger.debug(permissionObject.role);
      queryObj = await visibleFilter(queryObj, permissionObject.isAdmin);
      const parksData = await runQuery(queryObj);
      logger.info('Returning results:', parksData.length);
      return sendResponse(200, parksData, context);
    }

    let parksData = await runQuery(queryObj);
    console.log(parksData, "<-----parksData")
 

    if (permissionObject.isAdmin) {
      // Sysadmin, they get it all
      logger.info("**Sysadmin**")
    } else {
      // Some other authenticated role
      logger.info("**Some other authenticated person with parking-pass roles**")
      logger.debug(permissionObject.role)
      parksData = await roleFilter(parksData, permissionObject.role);
      logger.debug(JSON.stringify(parksData));
    }
    logger.info("Returning results:", parksData.length);
    return sendResponse(200, parksData, context);
  } catch (err) {
    logger.error(err);
    return sendResponse(400, err, context);
  }
};
