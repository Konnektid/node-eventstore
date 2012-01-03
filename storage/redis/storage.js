var redis = require('redis')
  , root = this
  , redisStorage
  , Storage;

if (typeof exports !== 'undefined') {
    redisStorage = exports;
} else {
    redisStorage = root.redisStorage = {};
}

redisStorage.VERSION = '0.0.1';

// Create new instance of storage.
redisStorage.createStorage = function(options, callback) {
    new Storage(options, callback);
};

/*******************************************
* Storage 
*/
Storage = function(options, callback) {
    if (typeof options === 'function')
        callback = options;
        
    var defaults = {
        host: 'localhost',
        port: 6379,
        database: 0,
        eventsCollectionName: 'events',
        snapshotsCollectionName: 'snapshots'
    };
    
    this.options = mergeOptions(options, defaults);
    this.client = redis.createClient(this.options.port, this.options.host);
    
    var self = this;
    this.client.on('ready', function () {
        if (options.database !== 0) {
            self.client.select(self.options.database, function(err, ok) {
                if (err) {
                    callback(err);
                } else {
                    callback(null, self);
                }
            });
        } else {
            callback(null, self);
        }
    });
};

Storage.prototype = {

    // This function saves an event in the storage.
    addEvents: function(events, callback) {
        if (!events || events.length === 0) { 
            callback(null);
            return;
        }
        
        var self = this
          , args = [];
          
        events.forEach(function(event) {
            args.push(JSON.stringify(event));
        });
        
        this.client.rpush(this.options.eventsCollectionName + ':' + events[0].streamId, args, function(err, res) {
            if (err) {
                callback(err);
            } else {
                self.client.rpush('undispatched:' + self.options.eventsCollectionName, args, callback);
            }
        });
    },
    
    // This function saves a snapshot in the storage.
    addSnapshot: function(snapshot, callback) {          
        this.client.lpush(this.options.snapshotsCollectionName + ':' + snapshot.streamId, JSON.stringify(snapshot), callback);
    },

    // This function returns the wished events.
    getEvents: function(streamId, minRev, maxRev, callback) {
        
        if (typeof maxRev === 'function') {
            callback = maxRev;
            maxRev = -1;
        }

        maxRev = maxRev > 0 ? maxRev - 1 : maxRev;
        
        this.client.lrange(this.options.eventsCollectionName + ':' + streamId, minRev, maxRev, function (err, res) {
            handleResultSet(err, res, callback);
        });
    },

    // This function returns all events.
    getAllEvents: function(callback) {
        
        var self = this;
        
        this.client.keys(this.options.eventsCollectionName + ':*', function (err, res) {
            if (err) {
                callback(err);
            } else {
                var arr = [];

                if (res.length === 0) {
                    callback(null, arr);
                } else {
                    var last = res[res.length - 1];
                    res.forEach(function(key) {
                        self.client.lrange(key, 0, -1, function (err, res) {
                            if (err) {
                                callback(err);
                            } else {
                                res.forEach(function(item) {
                                    arr.push(JSON.parse(item));
                                });
                            }
                            
                            if (key == last) {
                                callback(null, arr);
                            }
                        });
                    });
                }
            }
        });
    },

    // This function returns a range of events.
    getEventRange: function(index, amount, callback) {
        var self = this;
        
        this.client.keys(this.options.eventsCollectionName + ':*', function (err, res) {
            if (err) {
                callback(err);
            } else {
                var arr = [];

                if (res.length === 0) {
                    callback(null, arr);
                } else {
                    var last = res[res.length - 1];
                    res.forEach(function(key) {
                        self.client.lrange(key, 0, -1, function (err, res) {
                            if (err) {
                                callback(err);
                            } else {
                                res.forEach(function(item) {
                                    arr.push(JSON.parse(item));

                                    if (arr.length >= (index + amount)) {
                                        return;
                                    }
                                });
                            }
                            
                            if (key == last) {

                                arr = arr.slice(index, (index + amount));

                                callback(null, arr);
                            }
                        });
                    });
                }
            }
        });
    },

    // This function returns the wished snapshot.
    // If revMax is -1 returns the latest snapshot.
    getSnapshot: function(streamId, maxRev, callback) {
        
        if (typeof maxRev === 'function') {
            callback = maxRev;
            maxRev = -1;
        }
    
        if (maxRev === -1) {
            this.client.lrange(this.options.snapshotsCollectionName + ':' + streamId, 0, 0, function (err, res) {
                if (res && res.length === 1) {
                    callback(err, JSON.parse(res[0]));
                } else {
                    callback(err, null);
                }
            });
        }
        else {
            this.client.lrange(this.options.snapshotsCollectionName + ':' + streamId, 0, -1, function (err, res) {
                if (err) {
                    callback(err);
                } else if (res && res.length > 0) {
                    for (var i = res.length - 1; i >= 0; i--) {
                        var snap = JSON.parse(res[i]);
                        if (snap.revision <= maxRev) {
                            callback(null, snap);
                            break;
                        }
                    }
                }
                else {
                    callback(null, {});
                }
            });
        } 
    },

    // This function returns all undispatched events.
    getUndispatchedEvents: function(callback) {
    
        this.client.lrange('undispatched:' + this.options.eventsCollectionName, 0, -1, function (err, res) {
            handleResultSet(err, res, callback);
        });
    },

    // This function set an event to dispatched.
    setEventToDispatched: function(event) {
        this.client.lrem('undispatched:' + this.options.eventsCollectionName, JSON.stringify(event), 0);
    },

    // This function returns a new id.
    getId: function(callback) {
        this.client.incr('nextItemId', function(err, id) {
            if (err) {
                callback(err);
            } else {
                callback(null, id.toString());
            }
        });
    }
};

// helpers
var handleResultSet = function(err, res, callback) {
    if (err) {
        callback(err);
    }
    else if (res && res.length > 0) {
        var arr = [];

        res.forEach(function(item) {
            arr.push(JSON.parse(item));
        });
        
        callback(null, arr);
    }
    else {
        callback(null, []);
    }
};

var mergeOptions = function(options, defaultOptions) {
    if (!options || typeof options === 'function') {
        return defaultOptions;
    }
    
    var merged = {};
    for (var attrname in defaultOptions) { merged[attrname] = defaultOptions[attrname]; }
    for (var attrname in options) { if (options[attrname]) merged[attrname] = options[attrname]; }
    return merged;  
};