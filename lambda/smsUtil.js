const AWS = require('aws-sdk');
const { gcnSend } = require('./gcNotifyUtils');
const { sendResponse } = require('./responseUtil');
const { logger } = require('./logger');


exports.sendSMSMessage = async function (payload, cancellationLink){
    try {
      const gcnSendObj = {
        "phone_number": `1${payload.phoneNumber}`,
        "template_id": process.env.GC_NOTIFY_SMS_TEMPLATE_ID,
        "personalisation": {
          "name": `${payload.firstName} ${payload.lastName}`,
          "passType": payload.type,
          "parkName": payload.parkName,
          "facilityName": payload.facilityName,
          "cancellationLink": cancellationLink,
        }
      };

      console.log('Payload:', payload);
console.log('Template ID:', process.env.GC_NOTIFY_SMS_TEMPLATE_ID);
console.log('GCNSENDOBJ:', gcnSendObj);
      const res = await gcnSend(process.env.GC_NOTIFY_API_SMS_PATH, process.env.GC_NOTIFY_API_KEY, gcnSendObj);
      if (res.errors) {
        resData = res?.data?.response?.data;
        jobError = 'SMS Notification failed: ';
        logger.error(jobError, resData );
        throw new Error('SMS Notification failed');
      } else {
        resData = res?.data?.data?.data;
      }
      logger.info(resData);
      return sendResponse(200, { msg: 'All works?', title: 'Completed actions' })
    } catch (e) {
      logger.error(e)
      return sendResponse(400, { msg: 'SMS notification failed.', title: 'Operation Failed' });
    }
  }