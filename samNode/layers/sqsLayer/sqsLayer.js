const AWS = require('/opt/baseLayer');
const { logger, sqsSendMessage } = require('/opt/baseLayer');

exports.sendSQSMessage = async function (service, payload) {
  logger.info("SQSQUEUE:", process.env.SQSQUEUENAME);
  try {
    const params = {
      MessageBody: `SQS Message at ${(new Date()).toISOString()}`,
      QueueUrl: process.env.SQSQUEUENAME,
      MessageAttributes: {
        "email_address": {
          DataType: "String",
          StringValue: payload?.email_address
        },
        "template_id": {
          DataType: "String",
          StringValue: payload?.template_id
        },
        "personalisation": {
          DataType: "String",
          StringValue: JSON.stringify(payload?.personalisation)
        },
        "service": {
          DataType: "String",
          StringValue: service
        }
      }
    }
    logger.info("Sending SQS");
    if (process.env.IS_OFFLINE === 'true'){
      return
    }
    await sqsSendMessage(params);
  } catch (e) {
    logger.error(e);
  }
}