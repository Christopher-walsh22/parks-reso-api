const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken');
const axios = require('axios');

const { runQuery, TABLE_NAME, expressionBuilder, sendResponse, logger } = require('/opt/baseLayer');
const { getParkAccess } = require('/opt/permissionLayer');
const { DateTime } = require('luxon');
const ALGORITHM = process.env.ALGORITHM || "HS384";

exports.handler = async (event, context) => {
  logger.debug('Read Pass', event);

  let queryObj = {
    TableName: TABLE_NAME
  };
  try {
    if (!event.queryStringParameters) {
      return sendResponse(400, { msg: 'Invalid Request' }, context);
    }

    const permissionObject = event.requestContext.authorizer;
    permissionObject.role = JSON.parse(permissionObject.role);

    if (!event.queryStringParameters.manualLookup && event.queryStringParameters.facilityName && event.queryStringParameters.park) {
      
      if (permissionObject.isAuthenticated !== true) {
        logger.info('Unauthorized');
        return sendResponse(403, { msg: 'Unauthorized' });
      }

      // Ensure they have park level access.  Returns 403 if they are not allowed.
      try {
        await getParkAccess(event.queryStringParameters.park, permissionObject);
      } catch (error) {
        logger.error(error);
        return sendResponse(403, { msg: error.msg });
      }

      // Get all the passes for a specific facility
      if (event.queryStringParameters.date) {
        // Use GSI on manualLookupif date is provided
        const shortDate = DateTime.fromISO(event.queryStringParameters.date).toISODate();

        queryObj.ExpressionAttributeValues = {};
        queryObj.IndexName = 'manualLookup-index';
        queryObj.ExpressionAttributeValues[':shortPassDate'] = { S: shortDate };
        queryObj.ExpressionAttributeValues[':facilityName'] = { S: event.queryStringParameters.facilityName };
        queryObj.ExpressionAttributeValues[':passStatus'] = AWS.DynamoDB.Converter.input('hold');
        queryObj.KeyConditionExpression = 'shortPassDate =:shortPassDate AND facilityName =:facilityName';
        queryObj.FilterExpression = 'passStatus <> :passStatus';
      } else {
        queryObj.ExpressionAttributeValues = {};
        queryObj.ExpressionAttributeValues[':pk'] = { S: 'pass::' + event.queryStringParameters.park };
        queryObj.ExpressionAttributeValues[':facilityName'] = { S: event.queryStringParameters.facilityName };
        queryObj.ExpressionAttributeValues[':passStatus'] = AWS.DynamoDB.Converter.input('hold');
        queryObj.KeyConditionExpression = 'pk =:pk';
        queryObj.FilterExpression = 'facilityName =:facilityName and passStatus <> :passStatus';
      }

      if (event.queryStringParameters.passType) {
        queryObj.ExpressionAttributeValues[':passType'] = AWS.DynamoDB.Converter.input(
          event.queryStringParameters.passType
        );
        queryObj = checkAddExpressionAttributeNames(queryObj);
        queryObj.ExpressionAttributeNames['#theType'] = 'type';
        queryObj.FilterExpression += expressionBuilder('AND', queryObj.FilterExpression, '#theType =:passType');
      }

      // Filter Multiple Statuses
      if (event.queryStringParameters.passStatus) {
        const statusList = event.queryStringParameters.passStatus.split(',');
        const statusObj = {};
        for (let [index, status] of statusList.entries()) {
          const statusName = ':passStatus' + index;
          statusObj[statusName.toString()] = AWS.DynamoDB.Converter.input(status);
        }
        queryObj = checkAddExpressionAttributeNames(queryObj);
        queryObj.ExpressionAttributeNames['#theStatus'] = 'passStatus';
        Object.assign(queryObj.ExpressionAttributeValues, statusObj);
        queryObj.FilterExpression += expressionBuilder(
          'AND',
          queryObj.FilterExpression,
          '#theStatus IN (' + Object.keys(statusObj).toString() + ')'
        );
      }
      // Filter reservation number
      if (event.queryStringParameters.reservationNumber) {
        queryObj.ExpressionAttributeValues[':registrationNumber'] = AWS.DynamoDB.Converter.input(
          // BRS-748 will address inconsistent mapping of registrationNumber to reservationNumber
          event.queryStringParameters.reservationNumber
        );
        queryObj.FilterExpression += expressionBuilder(
          'AND',
          queryObj.FilterExpression,
          'registrationNumber =:registrationNumber'
        );
      }
      // Filter first/last
      if (event.queryStringParameters.firstName) {
        queryObj = checkAddExpressionAttributeNames(queryObj);
        queryObj.ExpressionAttributeValues[':searchFirstName'] = AWS.DynamoDB.Converter.input(
          event.queryStringParameters.firstName.toLowerCase()
        );
        queryObj.FilterExpression += expressionBuilder(
          'AND',
          queryObj.FilterExpression,
          'searchFirstName =:searchFirstName'
        );
      }
      if (event.queryStringParameters.lastName) {
        queryObj = checkAddExpressionAttributeNames(queryObj);
        queryObj.ExpressionAttributeValues[':searchLastName'] = AWS.DynamoDB.Converter.input(
          event.queryStringParameters.lastName.toLowerCase()
        );
        queryObj.FilterExpression += expressionBuilder(
          'AND',
          queryObj.FilterExpression,
          'searchLastName =:searchLastName'
        );
      }
      // Filter email
      if (event.queryStringParameters.email) {
        queryObj = checkAddExpressionAttributeNames(queryObj);
        queryObj.ExpressionAttributeValues[':email'] = AWS.DynamoDB.Converter.input(event.queryStringParameters.email);
        queryObj.FilterExpression += expressionBuilder('AND', queryObj.FilterExpression, 'email =:email');
      }
      // Filter overbooked status
      queryObj = checkOverbooked(event.queryStringParameters.overbooked, queryObj);
      queryObj = paginationHandler(queryObj, event);

      logger.info('Running query');
      logger.debug('queryObj:', queryObj);
      const passData = await runQuery(queryObj, true);
      return sendResponse(200, passData, context);
    } else if (event.queryStringParameters.passes && event.queryStringParameters.park) {
      logger.info('Grab passes for this park');
      if (permissionObject.isAdmin !== true) {
        logger.info('Unauthorized');
        return sendResponse(403, { msg: 'Unauthorized' });
      }
      // Grab passes for this park.
      queryObj.ExpressionAttributeValues = {};
      queryObj.ExpressionAttributeValues[':pk'] = { S: 'pass::' + event.queryStringParameters.park };
      queryObj.KeyConditionExpression = 'pk =:pk';

      // Filter overbooked status
      queryObj = checkOverbooked(event.queryStringParameters.overbooked, queryObj);

      queryObj = paginationHandler(queryObj, event);
      const passData = await runQuery(queryObj, true);
      logger.info('Returning Results:', passData.length);
      return sendResponse(200, passData, context);
    } else if (
      event.queryStringParameters.passId &&
      event.queryStringParameters.email &&
      event.queryStringParameters.park
    ) {
      logger.info('Get the specific pass, this person is NOT authenticated');
      // Get the specific pass, this person is NOT authenticated
      queryObj.ExpressionAttributeValues = {};
      queryObj.ExpressionAttributeValues[':pk'] = { S: 'pass::' + event.queryStringParameters.park };
      queryObj.ExpressionAttributeValues[':sk'] = { S: event.queryStringParameters.passId };
      queryObj.ExpressionAttributeValues[':email'] = { S: event.queryStringParameters.email };
      queryObj.KeyConditionExpression = 'pk =:pk AND sk =:sk';
      queryObj.FilterExpression = 'email =:email';
      logger.debug('queryObj', queryObj);
      queryObj = paginationHandler(queryObj, event);
      const passData = await runQuery(queryObj, true);
      logger.info('passData', passData.length);
      logger.debug('passData', passData);

      if (passData && passData.data && passData.data.length !== 0) {
        const dateselector = DateTime.fromISO(passData.data[0].date).toISODate();

        // Build cancellation email payload
        const claims = {
          iss: 'bcparks-lambda',
          sub: 'readPass',
          passId: event.queryStringParameters.passId,
          facilityName: passData.data[0].facilityName,
          numberOfGuests: passData.data[0].numberOfGuests,
          dateselector: dateselector,
          type: passData.data[0].type,
          parkSk: passData.data[0].pk.split('::')[1]
        };
        logger.info("Signing JWT");
        const token = jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: '15m', algorithm: ALGORITHM });

        const cancellationLink =
          process.env.PUBLIC_FRONTEND +
          process.env.PASS_CANCELLATION_ROUTE +
          '?passId=' +
          passData.data[0].registrationNumber +
          '&park=' +
          event.queryStringParameters.park +
          '&code=' +
          token;

        const encodedCancellationLink = encodeURI(cancellationLink);
        const dateOptions = { day: 'numeric', month: 'long', year: 'numeric' };
        let formattedDate = DateTime.fromISO(passData.data[0].date).toLocaleString(dateOptions);
        if (passData.data[0].type) {
          let formattedType = passData.data[0].type === 'DAY' ? 'ALL DAY' : passData.data[0].type;
          formattedDate += ' (' + formattedType + ')'
        }

        let personalisation = {
          registrationNumber: passData.data[0].registrationNumber.toString(),
          link: encodedCancellationLink,
          date: formattedDate,
          parkName: passData.data[0].parkName || '',
          facilityName: passData.data[0].facilityName || ''
        };

        // Send email
        // Public page after 200OK should show 'check your email'
        logger.info("Posting to GC Notify");
        try {
          await axios({
            method: 'post',
            url: process.env.GC_NOTIFY_API_PATH,
            headers: {
              Authorization: process.env.GC_NOTIFY_API_KEY,
              'Content-Type': 'application/json'
            },
            data: {
              email_address: passData.data[0].email,
              template_id: process.env.GC_NOTIFY_CANCEL_TEMPLATE_ID,
              personalisation: personalisation
            }
          });
          logger.info("GC Notify posted successfully.");
          return sendResponse(200, personalisation);
        } catch (err) {
          logger.error(err);
          let errRes = personalisation;
          errRes['err'] = 'Email Failed to Send';
          return sendResponse(200, errRes);
        }
      } else {
        logger.info("Invalid Request, pass does not exist.");
        return sendResponse(400, { msg: 'Invalid Request, pass does not exist' }, context);
      }
    } else if (event.queryStringParameters.passId && event.queryStringParameters.park) {
      if (permissionObject.isAuthenticated !== true
        || (permissionObject.roles.indexOf(event.queryStringParameters.park) === -1
            && permissionObject.roles.indexOf('sysadmin') === -1)) {
        logger.info("Unauthorized");
        return sendResponse(403, { msg: 'Unauthorized!' });
      } else {
        // Get the specific pass
        queryObj.ExpressionAttributeValues = {};
        queryObj.ExpressionAttributeValues[':pk'] = { S: 'pass::' + event.queryStringParameters.park };
        queryObj.ExpressionAttributeValues[':sk'] = { S: event.queryStringParameters.passId };
        queryObj.KeyConditionExpression = 'pk =:pk AND sk =:sk';
        const passData = await runQuery(queryObj, true);
        return sendResponse(200, passData, context);
      }
    } else if (event.queryStringParameters.manualLookup && event.queryStringParameters.park && event.queryStringParameters.date) {
      // Manual Lookup Search by ADMIN
      if (permissionObject.isAuthenticated !== true
          || (permissionObject.roles.indexOf(event.queryStringParameters.park) === -1
              && permissionObject.roles.indexOf('sysadmin') === -1)) {
        logger.info("Unauthorized.");
        logger.debug(permissionObject);
        return sendResponse(403, { msg: 'Unauthorized to perform this action.', title: 'Unauthorized.' });
      }

      return await checkManualLookup(event.queryStringParameters, queryObj, context);
    } else {
      logger.info('Invalid Request');
      return sendResponse(400, { msg: 'Invalid Request' }, context);
    }
  } catch (err) {
    logger.error(err);
    return sendResponse(400, err, context);
  }
};

const checkManualLookup = async function (queryStringParameters, queryObj, context) {
  try {
    // REQUIRED: park, date, facilityName
    // OPTIONAL: registrationNumber, email, firstName, lastName
    const date = queryStringParameters.date;
    const park = queryStringParameters.park;
    const facilityName = queryStringParameters.facilityName;
    const registrationNumber = queryStringParameters.registrationNumber;
    const email = queryStringParameters.email;
    const firstName = queryStringParameters.firstName;
    const lastName = queryStringParameters.lastName;

    const pk = `pass::${park}`;
    // Search the index
    queryObj['IndexName'] = 'manualLookup-index';
    queryObj['ExpressionAttributeValues'] = {
      ':shortPassDate': { S: date },
      ':facilityName': { S: facilityName },
      ':pk': { S: pk  }
    };
    queryObj['FilterExpression'] = 'pk = :pk';
    queryObj['KeyConditionExpression'] = 'shortPassDate = :shortPassDate AND facilityName = :facilityName';

    // Buid optionals
    if (registrationNumber !== undefined) {
      queryObj.FilterExpression += ' AND sk =:sk';
      queryObj.ExpressionAttributeValues[':sk'] = { S: registrationNumber };
    }
    if (email !== undefined) {
      queryObj.FilterExpression += ' AND email =:email';
      queryObj.ExpressionAttributeValues[':email'] = { S: email.toLowerCase() };
    }
    if (firstName !== undefined) {
      queryObj.FilterExpression += ' AND searchFirstName =:searchFirstName';
      queryObj.ExpressionAttributeValues[':searchFirstName'] = { S: firstName.toLowerCase() };
    }
    if (lastName !== undefined) {
      queryObj.FilterExpression += ' AND searchLastName =:searchLastName';
      queryObj.ExpressionAttributeValues[':searchLastName'] = { S: lastName.toLowerCase() };
    }
    const passData = await runQuery(queryObj);
    for(pass of passData) {
      pass['park'] = park;
      pass['facilityName'] = facilityName;
      delete pass.pk;
      delete pass.sk;
      delete pass.searchLastName;
      delete pass.searchFirstName;
    }
    return sendResponse(200, passData, context);
  } catch (e) {
    logger.info("Invalid Request (err):");
    logger.debug(e);
    return sendResponse(400, { msg: 'Invalid Request' }, context);
  }
}

const checkAddExpressionAttributeNames = function (queryObj) {
  if (!queryObj.ExpressionAttributeNames) {
    queryObj.ExpressionAttributeNames = {};
  }
  return queryObj;
};

const paginationHandler = function (queryObj, event) {
  if (event.queryStringParameters.ExclusiveStartKeyPK && event.queryStringParameters.ExclusiveStartKeySK) {
    // Add the next page.
    queryObj.ExclusiveStartKey = {
      pk: AWS.DynamoDB.Converter.input(event.queryStringParameters.ExclusiveStartKeyPK),
      sk: AWS.DynamoDB.Converter.input(event.queryStringParameters.ExclusiveStartKeySK)
    };
  }
  return queryObj;
};

function checkOverbooked (queryParams, queryObj) {
  if (queryParams === 'show') {
    queryObj.ExpressionAttributeValues[':isOverbooked'] = { BOOL: true };
    queryObj.FilterExpression += expressionBuilder('AND', queryObj.FilterExpression, 'isOverbooked=:isOverbooked');
  } else if (queryParams === 'hide') {
    queryObj.ExpressionAttributeValues[':isOverbooked'] = { BOOL: false };
    queryObj.FilterExpression += expressionBuilder('AND', queryObj.FilterExpression, 'isOverbooked=:isOverbooked');
  } 
  return queryObj;
};
