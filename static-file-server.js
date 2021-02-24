let port = process.env.PORT;
if (port == null || port == "") {
  port = 8000;
}
var express = require('express'),
    app = express();
app.use(express.static(__dirname + '/public'));
app.listen(port);
console.log('listening to port' + port);