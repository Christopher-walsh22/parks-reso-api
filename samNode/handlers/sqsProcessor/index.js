const { Console } = require('winston/lib/winston/transports');
const { logger } = require('/opt/baseLayer');
const axios = require('axios');

exports.handler = async (event) => {
  if (event === null || !(Symbol.iterator in Object(event.Records))) {
    logger.error('Invalid event object.');
    return {};
  }

  console.log("In the sqsProccessor!")
  console.log("event for the message? ", event)

  logger.info("SQS Processor:", event.Records?.length);

  for(const record of event.Records) {
    // Process GCN

    //because of sqs this is now a string. convert back to JSON
    console.log("record: ", record)
    console.log("In the for loop for processor record ===: ", record)
    let bodyObject;
    try {
      bodyObject = JSON.parse(record.body);
      if (bodyObject.service === 'GCN') {
        await handleGCNRecord(bodyObject);
      }
    } catch (error) {
      console.error("Error parsing JSON from record.body did not handle gcn record:", error);
      // Handle the error or gracefully fail as per your application's requirements
    }
    
  }

  return {};
};

const handleGCNRecord = async function (record) {
  logger.info('Handling GCN Record');
  console.log("handlingi the record." )
  const gcnData = {
    email_address: record.email_address,
    template_id: record.template_id,
    personalisation: record.personalisation
  };
  logger.info('Sending payload to GCN');
  // Email this using GCNotify.  Allow this to throw without a catch as it will push it back
  // into the SQS queue.
  console.log("About to axios this stuf:: ")
  console.log("URL: ", process.env.GC_NOTIFY_API_PATH)
  console.log("Authorization: ", process.env.GC_NOTIFY_API_KEY)
  console.log("Data: ", gcnData)
  await axios({
    method: 'post',
    url: process.env.GC_NOTIFY_API_PATH,
    headers: {
      Authorization: process.env.GC_NOTIFY_API_KEY,
      'Content-Type': 'application/json'
    },
    data: gcnData
  });
  logger.info('GCNotify email sent.');
}