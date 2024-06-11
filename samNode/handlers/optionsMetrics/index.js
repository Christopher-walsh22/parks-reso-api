const { logger, sendResponse } = require('/opt/baseLayer');
exports.handler = async (event, context) => {
  logger.debug('Metrics Options', event);

  if (event.httpMethod === 'OPTIONS') {
    return sendResponse(200, {}, 'Success', null, context);
  }
  
};