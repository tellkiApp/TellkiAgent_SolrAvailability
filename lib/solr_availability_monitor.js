/**
 * This script was developed by Guberni and is part of Tellki's Monitoring Solution
 *
 * June, 2015
 * 
 * Version 1.0
 * 
 * DESCRIPTION: Monitor Solr Availability
 *
 * SYNTAX: node solr_availability_monitor.js <METRIC_STATE> <HOST> <PORT> <PATH> <USERNAME> <PASSWORD>
 * 
 * EXAMPLE: node solr_availability_monitor.js "1,1" "10.10.2.5" "8983" "solr" "username" "password"
 *
 * README:
 *    <METRIC_STATE> is generated internally by Tellki and it's only used by Tellki default monitors: 1 - metric is on; 0 - metric is off
 *    <HOST> solr ip address or hostname
 *    <PORT> solr port
 *    <PATH> solr path
 *    <USERNAME> solr username
 *    <PASSWORD> solr password
 */

var solr = require('solr');
var http = require('http');
 
/**
 * Metrics.
 */
var metrics = [];
metrics['Status'] =       { id: '1709:Status:9' };
metrics['ResponseTime'] = { id: '1710:Response Time:4' };
 
var inputLength = 6;
 
/**
 * Entry point.
 */
(function() {
  try
  {
    monitorInput(process.argv);
  }
  catch(err)
  { 
    if(err instanceof InvalidParametersNumberError)
    {
      console.log(err.message);
      process.exit(err.code);
    }
    else if(err instanceof UnknownHostError)
    {
      console.log(err.message);
      process.exit(err.code);
    }
    else
    {
      console.log(err.message);
      process.exit(1);
    }
  }
}).call(this);

// ############################################################################
// PARSE INPUT

/**
 * Verify number of passed arguments into the script, process the passed arguments and send them to monitor execution.
 * Receive: arguments to be processed
 */
function monitorInput(args)
{
  args = args.slice(2);
  if(args.length != inputLength)
    throw new InvalidParametersNumberError();
  
  //<METRIC_STATE>
  var metricState = args[0].replace('"', '');
  var tokens = metricState.split(',');
  var metricsExecution = new Array();
  for(var i in tokens)
    metricsExecution[i] = (tokens[i] === '1');
  
  //<HOST> 
  var hostname = args[1];
  
  //<PORT> 
  var port = args[2];
  if (port.length === 0)
    port = '8983';

  //<PATH>
  var path = args[3];
  path = path[0] === '/' ? path : '/' + path;

  // <USER_NAME>
  var username = args[4];
  username = username.length === 0 ? '' : username;
  username = username === '\"\"' ? '' : username;
  if(username.length === 1 && username === '\"')
    username = '';
  
  // <PASS_WORD>
  var passwd = args[5];
  passwd = passwd.length === 0 ? '' : passwd;
  passwd = passwd === '\"\"' ? '' : passwd;
  if(passwd.length === 1 && passwd === '\"')
    passwd = '';
  
  if(username === '{0}')
    username = passwd = '';

  // Create request object to be executed.
  var request = new Object()
  request.checkMetrics = metricsExecution;
  request.hostname = hostname;
  request.port = port;
  request.path = path;
  request.username = username;
  request.passwd = passwd;
  
  // Get metrics.
  processRequest(request);
}

// ############################################################################
// GET METRICS

/**
 * Retrieve metrics information
 * Receive: object request containing configuration
 */
function processRequest(request) 
{
  getCores(request, function(core) {
    getData(request, core);
  });
}

function getCores(request, callback)
{
  // Create HTTP request options.
  var options = {
    method: 'GET',
    hostname: request.hostname,
    port: request.port,
    path: request.path + '/admin/cores?action=STATUS&wt=json'
  };

  if (request.username !== '')
    options.auth = request.username + ':' + request.passwd;

  // Do HTTP request.
  var req = http.request(options, function (res) {
    var data = '';
    
    // HTTP response status code.
    var code = res.statusCode;
    
    if (code != 200)
    {
      if (code == 401)
      {
        errorHandler(new InvalidAuthenticationError());
      }
      else
      {
        var exception = new HTTPError();
        exception.message = 'Response error (' + code + ').';
        errorHandler(exception);
      }
    }
    
    res.setEncoding('utf8');
    
    // Receive data.
    res.on('data', function (chunk) {
      data += chunk;
    });
    
    // On HTTP request end.
    res.on('end', function (res) {
      var o = JSON.parse(data);
      if (Object.keys(o.status).length > 0)
      {
        // Get first core.
        var core = Object.keys(o.status)[0];
        callback(core);
      }
      else
      {
        errorHandler(new MetricNotFoundError());
      }
    });
  });
  
  // On Error.
  req.on('error', function (e) {
    if(e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED')
      errorHandler(new UnknownHostError());
    else
      errorHandler(e);
  });

  req.end();
}


function getData(request, core)
{
  var metricsObj = [];
  var ts = new Date();

  var options = {
    host: request.hostname,
    port: request.port,
    path: request.path,
    core: '/' + core
  };

  if (request.username !== '')
    options.auth = request.username + ':' + request.passwd;
  
  var client = solr.createClient(options);

  client.on('error', function (e) {
    // Status
    if (request.checkMetrics[0])
    {
      var metric = new Object();
      metric.id = metrics['Status'].id;
      metric.val = '0';
      metricsObj.push(metric);
    }

    // Output
    output(metricsObj);
  });

  // TODO http://localhost:8080/solr/new_core/select?q=*%3A*&start=0&rows=1&wt=json&indent=true

  client.query('*', { rows : 1 }, function(err, response) {
    if (err) {
      return;
    }
    
    ts = (new Date()) - ts;

    // Status
    if (request.checkMetrics[0])
    {
      var metric = new Object();
      metric.id = metrics['Status'].id;
      metric.val = '1';
      metricsObj.push(metric);
    }

    // Response time
    if (request.checkMetrics[1])
    {
      var metric = new Object();
      metric.id = metrics['ResponseTime'].id;
      metric.val = ts;
      metricsObj.push(metric);
    }

    // Output
    output(metricsObj);
  });
}

// ############################################################################
// OUTPUT METRICS

/**
 * Send metrics to console
 * Receive: metrics list to output
 */
function output(metrics)
{
  for (var i in metrics)
  {
    var out = '';
    var metric = metrics[i];
    
    out += metric.id;
    out += '|';
    out += metric.val;
    out += '|';
    
    console.log(out);
  }
}

// ############################################################################
// ERROR HANDLER

/**
 * Used to handle errors of async functions
 * Receive: Error/Exception
 */
function errorHandler(err)
{
  if(err instanceof UnknownHostError)
  {
    console.log(err.message);
    process.exit(err.code);
  }
  else if (err instanceof MetricNotFoundError)
  {
    console.log(err.message);
    process.exit(err.code);   
  }
  else
  {
    console.log(err.message);
    process.exit(1);
  }
}

// ############################################################################
// EXCEPTIONS

/**
 * Exceptions used in this script.
 */
function InvalidParametersNumberError() {
    this.name = 'InvalidParametersNumberError';
    this.message = 'Wrong number of parameters.';
  this.code = 3;
}
InvalidParametersNumberError.prototype = Object.create(Error.prototype);
InvalidParametersNumberError.prototype.constructor = InvalidParametersNumberError;

function UnknownHostError() {
    this.name = 'UnknownHostError';
    this.message = 'Unknown host.';
  this.code = 28;
}
UnknownHostError.prototype = Object.create(Error.prototype);
UnknownHostError.prototype.constructor = UnknownHostError;

function MetricNotFoundError() {
    this.name = 'MetricNotFoundError';
    this.message = '';
  this.code = 8;
}
MetricNotFoundError.prototype = Object.create(Error.prototype);
MetricNotFoundError.prototype.constructor = MetricNotFoundError;
