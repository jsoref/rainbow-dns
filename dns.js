var dns          = require('native-dns')
var consts       = require('native-dns-packet').consts
var utils        = require('./utils')
var queryMatcher = require('./querymatcher')

var RainbowDns = function (argv, store) {
    this.argv       = argv
    this.store      = store
    this.server     = dns.createServer()
    if (argv.fwdhost) this.fwdserver = { address: argv.fwdhost, port: argv.fwdport || 53, type: 'udp' }
}
RainbowDns.prototype.forward = function (request, response) {
    var req = dns.Request({
        question : request,
        server   : this.fwdserver,
        timeout  : 1000
    })
    req.on('message', function(err, answer) {
        response.answer       = answer.answer
        response.authority    = answer.authority
        response.additional   = answer.additional
        response.edns_options = answer.edns_options
        try {
            response.send()
        } catch(e) {
            req.cancel()
            console.log('Error sending forward requrest: ',e)
        }
    })
    req.on('timeout', function () {
        req.cancel()
        console.log('Timeout in making forward request');
    });
    req.send()
}
RainbowDns.prototype.handleRequest = function (request, response) {
    var _request = request.question[0]
    var types  = this.pickAnswerTypes(request, response) // <- pick keys
    var _types = this.mapResponseObjects(types)
    // queryStore
    switch(_request.type) {
        case 1:
            this.handleARequest(request, response)
            break
        case 28:
            (this.argv['ipv4-only']) ? this.handleARequest(request, response) : this.handleAAAARequest(request, response)
            break
        case 33:
            this.handleSRVRequest(request, response)
            break
    }
    if (response.answer.length == 0 && this.fwdserver) this.forward(request.question[0], response)
    else response.send()
}
RainbowDns.prototype.pickAnswerTypes = function(request) {
    return this.includeAnswerTypes(consts.QTYPE_TO_NAME[request.question[0].type])
}
RainbowDns.prototype.includeAnswerTypes = function(queryType) {
    switch (queryType) {
        case 'A':
            return ['A','CNAME']
        case 'AAAA':
            return ['AAAA','CNAME']
        default:
            return [queryType]
    }
}
RainbowDns.prototype.mapResponseObjects = function(responseTypes) {
    return responseTypes
        .map(function(rtype) {
            return { type : rtype, obj : dns[rtype] }
        })
        .filter(function(mapped) {
            return typeof mapped.obj == 'function'
        }).reduce(function(res, current) {
            res[current.type] = current.obj
            return res
        }, {})
}
RainbowDns.prototype.queryStore = function(request, response) {
    var _request = request.question[0]
    var query = request.question[0].name
    console.log(_request.type)
    console.log(consts.QTYPE_TO_NAME[_request.type])
    // this.store.list(function (err, records) {
    //     if (err) { console.log('A REQUEST ERROR: ',err); process.exit(1) }
    //     var matchedRecords = queryMatcher(records, query, 'ipv4')
    //     // TODO: check cache entry if round-robin
    //     matchedRecords.forEach(function(record) {
    //         response.answer.push(dns.A(record))
    //     })
    // })    
}
RainbowDns.prototype.handleARequest = function (request, response) {
    var query = request.question[0].name
    this.store.list(function (err, records) {
        if (err) { console.log('A REQUEST ERROR: ',err); process.exit(1) }
        var matchedRecords = queryMatcher(records, query, 'ipv4')
        // TODO: check cache entry if round-robin
        matchedRecords.forEach(function(record) {
            response.answer.push(dns.A(record))
        })
    })
}
RainbowDns.prototype.handleAAAARequest = function (request, response) {
    var query = request.question[0].name
    this.store.list(function (err, records) {
        if (err) { console.log('AAAA REQUEST ERROR: ',err); process.exit(1) }
        var matchedRecords = queryMatcher(records, query, 'ipv6')
        // TODO: check cache entry if round-robin
        matchedRecords.forEach(function(record) {
            response.answer.push(dns.AAAA(record))
        })
    })
}
RainbowDns.prototype.handleSRVRequest = function (request, response) {

}
RainbowDns.prototype.start = function () {
    this.server.on('request', this.handleRequest.bind(this))
    this.server.on('listening', function () {
        utils.displayServiceStatus('dns', 'udp://'+this.argv.dnshost+':'+this.argv.dnsport, true)
    }.bind(this))
    this.server.on('close', function () {
        utils.displayErrorMessage('DNS socket unexpectedly closed', null, { exit : true })
    })
    this.server.on('error', function (err) {
        utils.displayErrorMessage('Unknown DNS error', err, { exit : true })
    })
    this.server.on('socketError', function (err) {
        utils.displayErrorMessage('DNS socket error occurred', err, { exit : true, hint : 'Port might be in use or you might not have permissions to bind to port. Try sudo?' })
    })
    this.server.serve(this.argv.dnsport, this.argv.dnshost)
}

module.exports = function (argv, store) {
    return new RainbowDns(argv, store)
}
