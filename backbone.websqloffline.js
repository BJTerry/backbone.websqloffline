// This is a library to use WebSQL to syncrhonize a local long-term datastore with a remote server

(function(_, Backbone) {
    "use strict";
    //Offline handles the dispatch to storage methods, and acts as a namespace for the other modules
    var Offline = {
        localSync: function(method, model, options, store) {
            var resp;
            switch (method) {
            case 'read':
                if(_.isUndefined(model.id)) {
                    resp = store.findAll(options);
                } else {
                    resp = store.find(model, options);
                }
                break;
            case 'create':
                resp = store.create(model, options);
                break;
            case 'update':
                resp = store.update(model, options);
                break;
            case 'delete':
                resp = store.destroy(model, options);
                break;
            }
        },
        sync: function(method, model, options) {
            var store = model.storage || (model.collection ? model.collection.storage : undefined);
            if(store && store.support){
                Offline.localSync(method, model, options, store);
            } else {
                Backbone.ajaxSync(method, model, options);
            }
        },

        onLine: function() {
            //This isn't supported in Firefox properly?
            return window.navigator.onLine !== false;
        }
    };

 

    Backbone.ajaxSync = Backbone.sync;
    Backbone.sync = Offline.sync;

    window.Offline = Offline;
    
    //Storage provides the interface to Web SQL
    function Storage(name, collection, options) {
        options = options || {};
        this.name = name;
        this.collection = collection;
        this.keys = options.keys || {};
        this.autoPush = options.autoPush || false;
        this.support = _.isFunction(window.openDatabase);
        this.sync = new Offline.Sync(collection, this);
        
        // We need to update our key fields any time the id changes. Should usually only occur when going from a client id
        // to a server id.
        for (var keyName in this.keys) {
            if(this.keys.hasOwnProperty(keyName)){
                var keyCollection = this.keys[keyName];

                keyCollection.on("change:id", function (keyModel, value, options) {
                    var oldId = keyModel.previousAttributes()[keyModel.idAttribute];
                    var changedModels = collection.filter(function(model){ return model.get(keyName) === oldId; });
                    changedModels.forEach(function (model) {
                        model.set(keyName, keyModel.id);
                    });
                });
            }
        }

        if(!Storage.prototype.db){
            Storage.prototype.db = openDatabase('bb-wsql', '1.0', 'Database for backbone.websqloffline', 1 * 1024 * 1024);
        }

        this.db = Storage.prototype.db;

        this.db.transaction(function(t) {
            t.executeSql("CREATE TABLE IF NOT EXISTS " + name + " (id PRIMARY KEY ASC, dirty, updated_at, deleted, attributes)", [],
                        function(t, r) {
                            return;
                        },
                        function(t, e) {
                            return;
                        });
        });
        //setName sets the database table name used for this storage. If that table already exists, the old table
        //is discarded and the new table is used instead
        this.setName = function(name) {
            var that = this;
            if(name !== that.name) {
                this.db.transaction(function(t) {
                    var oldName = that.name; 
                    t.executeSql("SELECT name FROM sqlite_master WHERE type = ? AND name = ?", ['table', name],
                        function(t, resultSet) {
                            if(resultSet.rows.length === 1){
                                //This table already exists. In this case we just switch to it, discarding the old table.
                                that.name = name;
                                t.executeSql("DROP TABLE " + oldName, [], function(){
                                    return; 
                                }, function(){
                                    return; 
                                });
                            } else {
                                //The new table doesn't already exist.
                                t.executeSql("ALTER TABLE " + oldName + " RENAME TO " + name, [],
                                    function(t, r) {
                                        that.name = name;
                                        return;
                                    },
                                    function(t, e) {
                                        return;
                                    });

                            }   

                        }, 
                        function(t, e) {
                            
                        });
                });  
            }
        };

        this.create = function(model, options) {
            this.save(model, options);
        },
        
        this.update = function(model, options) {
            this.save(model, options);
        },

        this.destroy = function(model, options) {
            //console.log("destroy: ", model, options);

            options = options || {};
            var success = options.success || function() {},
                error = options.error || function() {},
                that = this;
            
            if(options.local || this.matchClientId(model.id)) {
                //Just destroy from database immediately
                this.remove(model, options);
            } else {
                //Just set to deleted in the database
                this.db.transaction(function(t) {
                    t.executeSql('UPDATE ' + that.name + ' SET deleted = ? WHERE id = ?', [true, model.id],
                                 function(t, resultSet) {
                                    model.deleted = true;
                                    delete options.success;
                                    success(model, "success", options);
                                },
                                 function(t, e) {
                                    error(e);
                                });
                });                 
            }
        };

        //This function determines whether an item is awaiting deletion from the client-side
        //It is an error to call this function with a client-side id.
        this.isDeleted = function(id, trueCallback, falseCallback) {
            //console.log("isDeleted: ", id, trueCallback, falseCallback);
            falseCallback = falseCallback || function() {};
            trueCallback = trueCallback || function() {};
            var that = this;
            if(this.matchClientId(id)){
                console.log("isDeleted called with client id");
                return;
            }   
                            
            this.db.readTransaction(function(t) {
                t.executeSql('SELECT COUNT (*) AS c FROM ' + that.name + ' WHERE id = ? AND deleted = ?', [id, true],
                    function(t, resultSet) {
                        if(resultSet.rows.item(0).c === 0){
                            falseCallback();
                        }
                        else{
                            trueCallback();
                        }
                    });
            });
        },


        //deletedItems calls its success callback with an array of server ids.
        this.deletedItems = function(success, error){
            //console.log("deletedItems: ", success, error);
            var that = this;
            this.db.readTransaction(function(t) {
                t.executeSql('SELECT id FROM '+ that.name +' WHERE deleted = ?', [true],
                            function(t, resultSet){
                                var rows = [];
                                for(var x = 0; x < resultSet.rows.length; x++){
                                    rows.push(resultSet.rows.item(x).id);
                                }
                                success(rows);
                            },
                            function(t, e) {
                                if(error){
                                    error(e);
                                }   
                            });
            });
        },

        this.find = function(model, options){
            //console.log("find: ", model, options);
            options = options || {};
            var success = options.success || function(){};
            var error = options.error || function(){};
            var that = this;

            this.db.readTransaction(function(t){
                t.executeSql('SELECT attributes FROM '+ that.name +' WHERE id = ? AND deleted = ?', [model.id, false],
                             function(t, resultSet){
                                    if(resultSet.rows.length > 0){
                                        var result = JSON.parse(resultSet.rows.item(0).attributes);
                                        delete options.success;
                                        success(result, "success", options);
                                    }
                                    else {
                                        error("Record not found");
                                    }
                                },
                             function(t, e){
                                    error(e);
                                });
            });
            
        };
        
        this.save = function(item, options){
            //console.log("save", item, options);
            options = options || {};
            var success = options.success || function(){};
            var error = options.error || function(){};
            var that = this;
            var id;
            
            if(!options.local){
                var updated_at = new Date();
                item.set({updated_at: updated_at.toJSON()});
                item.dirty = true;
            }

            var newItem;
            
            if(!item.attributes) {
                console.log("Save shouldn't be called with a bare object");
                return;
            }

            if(_.isUndefined(item.deleted)){
                //new items aren't deleted
                item.deleted = false;
            }

            //If this is a new item, let's give it a client id. 
            id = item.id || this.generateClientId();
            if (_.isUndefined(item.attributes[item.idAttribute])){
                item.set(item.idAttribute, id);
            }
            
            this.db.transaction(function (t) {
                t.executeSql('INSERT OR REPLACE INTO ' + that.name + ' (id, dirty, updated_at, deleted, attributes) VALUES (?,?,?,?,?)', 
                             [id, item.dirty, item.get('updated_at'), item.deleted, JSON.stringify(item.attributes)],
                             function (t, r) {
                                 //Signal the changed item id, if necessary
                                 item.set(item.idAttribute, id);
                                 delete options.success;
                                 success(newItem, "success", options);
                             }, function (t, e) {
                                 error(e);
                                 item.trigger('error', item, false, options);
                             }
               );
            });

        };
            
            
        //Calls success callback with all of the non-deleted items in the sql table. 
        this.findAll = function(options){
            //console.log("findAll", options);
            options = options || {};
            var success = options.success || function(){};
            var error = options.error || function(){};
            var that = this;

            //options.local signals that the user doesn't want a server trip on the fetch
            if(options.local){
                this.db.readTransaction(function(t){
                    t.executeSql('SELECT id, attributes FROM '+ that.name +' WHERE deleted = ?', [false],
                                 function(t, resultSet){
                                     var jsonResult = [];
                                     for(var x = 0; x < resultSet.rows.length; x++){
                                         var fromJson = JSON.parse(resultSet.rows.item(x).attributes);
                                         jsonResult.push(fromJson);
                                         
                                     }
                                     delete options.success;

                                     success(jsonResult, "success", options);
                                 },
                                 function(t,e){
                                     error(e);
                                 });
                });
            } else {
                this.isEmpty(
                    //We don't have anything on the client
                    function(){
                        var newOptions = _.clone(options);
                        //We will sync, then sync will call findAll again but with local = true
                        //We want to return even if there is an error connecting
                        newOptions.success = newOptions.error = function() {
                            options.local = true;
                            that.findAll(options);
                        };
                        that.sync.full(newOptions);
                    },
                    //Client has table data
                    function(){
                        //If our store isn't empty, then we are good
                        var newOptions = _.clone(options);
                        newOptions.local = true;
                        that.findAll(newOptions);
                    });
                
            }
        };

        //Calls the callbacks depending on whether we have any items in the clientside table.
        //Even deleted items are included.
        this.isEmpty = function(trueCallback, falseCallback){
            //console.log("isEmpty: ", trueCallback, falseCallback);
            var that = this;
            trueCallback = trueCallback || function(){};
            falseCallback = falseCallback || function(){};
            this.db.readTransaction(function(t){
                t.executeSql('SELECT COUNT(*) AS c FROM '+ that.name, [],
                             function(t, r) {
                                 if(r.rows.item(0).c === 0){
                                     trueCallback();
                                 } else {
                                     falseCallback();
                                 }
                             });
            });                          
        };
        
        //Removes an item from the datastore completely
        this.remove = function(item, options){
            //console.log("remove");
            options = options || {};
            var success = options.success || function(){};
            var error = options.error || function(){};
            var that = this;
            var id = (item && item.id) ? item.id : item; //Accept item or bare id
            
            if(id){
                //Has to have an id to be deleted from sql
                this.db.transaction(function(t){
                    t.executeSql('DELETE FROM '+ that.name +' WHERE id = ?', [id],
                                 function(t, r){
                                     delete options.success;
                                     success(item, "success", options);
                                 },
                                 function(t, e){
                                     error(e);
                                 });
                });
            }
        };

        //Removes all the items from the table
        this.clear = function(success, error) {
            //console.log("clear", success, error);
            success = success || function(){};
            error = error || function(){};
            var that = this;
            this.db.transaction(function(t){
                t.executeSql('DELETE FROM '+ that.name, [],
                            function(t, r){
                                success();
                            },
                            function(t, e){
                                error(e);
                            });
            });
        };

       
        //Replaces fields in the item with ids from another collection based on this.keys.
        //Returns just the processed attributes object. Method is 'local' or 'server' depending
        //on the direction to which we are converting. 'local' converts to local ids from sids,
        //'server' converts from local ids to sids.
        this.replaceKeyFields = function(item, method, error) {
            //console.log("replaceKeyFields: ", item, method, error);
            if(item.attributes)
                item = _.clone(item.attributes);
            else
                item = _.clone(item);

            error = error || function(){};
            
            for(var field in this.keys){
                var collection = this.keys[field];
                var replacedField = item[field];
                
                
                if(method == 'local' && replacedField){
                    //if the field to replace is null, then we can ignore it
                    var wrapper = new Offline.Collection(collection);
                    //Get the item by sid
                    var replaced = wrapper.get(replacedField);
                    if(replaced)
                        //Replace with local id
                        item[field] = replaced.id;
                    else {
                        console.log("Could not locate matching local id for key");
                        error(item, "Could not locate matching local id for key");

                    }
                } else if(method == 'server' && replacedField){
                    var replaced = collection.get(replacedField);
                    if(replaced.sid){
                        if(replaced.sid == 'new'){
                            console.log("Could not locate matching sid for key");
                            error(item, "Could not locate matching sid for key");
                            //Don't know what to do if there is a reference to a 'new' item.
                            //error("Trying to replace client id with new server id");
                        } else
                            item[field] = replaced.sid;
                    }
                }
            }
            
            return item;
        };

        this.generateClientId = function(){
            function s4() {
                return Math.floor((1 + Math.random()) * 0x10000)
                       .toString(16)
                       .substring(1);
            };

            return 'cid-' + s4() + s4() + '-' + s4() + '-' + s4() + '-' +
                   s4() + '-' + s4() + s4() + s4();
        }

        this.matchClientId = function (id) {
            if(!_.isString(id)){
                return false;
            }
            return id.match(/cid-[0-9a-zA-Z]{8}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{12}/);
        }
    };
    Offline.Storage = Storage;

    //Handles the synchronization between client and server datastores
    function Sync(collection, storage){
        this.collection = new Offline.Collection(collection);
        this.storage = storage;
        // This is the time in milliseconds required before the framework is willing to do another sync.
        // Defaults to one second.
        this.minimumTime = 1000; 

        this.ajax = function(method, model, options){
            if(Offline.onLine()){
                this.prepareOptions(options);
                return Backbone.ajaxSync(method, model, options);
            } else {
                this.online = false;
                return null;
            }
            
        };

        //If the app was offline, we want to schedule an incremental now that it's back online.
        this.prepareOptions = function(options){
            //console.log("prepareOptions", options);
            if(!this.online){
                var that = this;
                this.online = true;
                var success = options.success || function(){};
                options.success = function(model, response, opts) {
                    success(model, response, opts);
                    that.incremental();
                };
            }
        };

        //Deletes all client side data and replaces it with server data indiscriminately
        //The only option that are recognized is options.error and options.succes
        this.full = function(options){
            //console.log("full", options);
            var that = this;
            var success = function(){
                setTimeout(function(){
                    delete that.fulljqXHR;
                }, that.minimumTime);
                if(options.success)
                    options.success.apply(options, arguments);
            };
            var error = function(){
                delete that.fulljqXHR;
                if(options.error)
                    options.error.apply(options, arguments);
            };

            var helper = function(){
                if(that.fulljqXHR){
                    that.fulljqXHR.done(success).fail(error);
                } else {
                    that.fulljqXHR = that.ajax('read', that.storage.collection,
                                                    _.extend({},
                                                             options,
                                                             {success: function(response, status, xhr){
                                                                 that.storage.clear(
                                                                     function(){
                                                                         
                                                                         that.storage.collection.reset([], {silent: true});
                                                                         var items = 0;
                                                                         var innerSuccess = function(){
                                                                                 that.storage.collection.trigger('reset', that.storage.collection, options);
                                                                                 success(that.storage.collection, response, xhr);
                                                                         };
                                                                         innerSuccess = _.after(response.length, innerSuccess);
                                                                         
                                                                         for(var x = 0; x < response.length; x++){
                                                                             var item = response[x];
                                                                             that.storage.collection.create(item, {silent: true,
                                                                                                                   local: true,
                                                                                                                   success: innerSuccess,
                                                                                                                   wait: true
                                                                                                                  });    
                                                                         }
                                                                     },
                                                                     error
                                                                 );
                                                             },
                                                              error: error})
                                                   );
                }
                
            };

            if(options.ignoreDependencies){
                helper();
            } else {
                this.syncDependencies({
                    success: helper,
                    error: options.error
                });
            }                       
        };

        this.getAllDependencies = function(){
            // All of the storages of dependencies of this object, sorted in order of the keys, with duplicates removed.
            // Removing duplicates should mean that collections required by multiple dependencies should be at the front of the list.
            // This doesn't deal well with circular key dependencies.
            var dependencies = _.values(this.storage.keys);
            if(dependencies.length > 0){
                var nestedDeps = _.map(dependencies, function(coll){
                    if(coll && coll.storage && coll.storage.sync){
                        return coll.storage.sync.getAllDependencies();
                    }
                    return undefined;
                });
                nestedDeps.push(this);
                return _.uniq(_.flatten(nestedDeps));
            } else {
                return [this];
            }
        };

        this.syncDependencies = function(options){
            //console.log("syncDependencies", options);
            var success = options.success || (function(){});
            var dependencies = this.getAllDependencies();
            dependencies.pop(); //Remove "this" from the list

            if(dependencies.length > 0){
         
                success = _.after(dependencies.length, success);
                _.each(dependencies, function(sync){
                    sync.incremental({
                        success: success,
                        ignoreDependencies: true,
                        error: options.error
                    });
                });
            } else {
                success();
            }
        };

        //Performs a pull/push incremental sync
        this.incremental = function(options){
            //console.log("incremental", options);
            options = options || {};
            var success = options.success || function(){};
            delete options.success; //Don't want success callback called prematurely.
            var that = this;

            var helper = function(){
                that.pull(_.extend({}, options, {success: function(){
                    options.success = success;
                    that.push(options);
                }}));  
            };
            
            if(options.ignoreDependencies){
                helper();
            } else {
                this.syncDependencies({
                    success: helper,
                    error: options.error
                });
            }
            
            
        };


        //Checks the server for new items by downloading the entire collection
        this.pull = function(options){
            //console.log("pull", options);
            options = options || {};
            var that = this;
            var success = function(){
                setTimeout(function(){
                    delete that.pulljqXHR;
                }, that.minimumTime);
                if(options.success)
                    options.success.apply(options, arguments);
            };
            var error = function(){
                delete that.pulljqXHR;
                if(options.error){
                    options.error.apply(options, arguments);
                }
            };

            if(that.pulljqXHR){
                that.pulljqXHR.done(success).fail(error);
            } else {

                var helper = function(){

                    that.pulljqXHR = that.ajax('read', that.collection.items, _.extend({}, options, {
                        success: function(response, status, xhr){
                            that.collection.destroyDiff(response);
                            var itemCount = response.length;
                            var success = _.after(itemCount, options.success);
                            for(var x = 0; x < itemCount; x++){
                                var item = response[x];
                                that.pullItem(item, function(){
                                    //Call callback after processing last item.
                                    success(that.collection, response, xhr);
                                });
                            }
                        },
                        error: error 
                    }));    
                };
                
                if(options.ignoreDependencies){
                    helper();
                } else {
                    this.syncDependencies({
                        success: helper,
                        error: options.error
                    });
                }   
            }
        };
        
        this.pullItem = function(item, success){
            //console.log("pullItem: ", item, success);
            var local = this.storage.collection.get(item.id);
            if(local)
                this.updateItem(item, local, success);
            else
                this.createItem(item, success);
        };

        this.createItem = function(item, success){
            //console.log("createItem: ", item, success);

            var that = this;
            
            this.storage.isDeleted(item.id,
                                   function(){
                                       //Is awaiting deletion from our side, do nothing
                                       success();
                                   },
                                   function(){
                                       that.collection.items.create(item, {local: true, success: success, wait: true});
                                   });
        };

        this.updateItem = function(item, model, success){
            //console.log("updateItem: ", item, success);

            if(new Date(model.get('updated_at')) < (new Date(item.updated_at))){
                model.save(item, {local: true, success: success, wait: true});
            } else {
                success(model);
            }
        };

        //Uploads dirty client side data and deleted items to the server
        this.push = function(options){
            //console.log("push: ", options);

            options = options || {};
            var that = this;
            
            var success, error;

            if(this.pushDeferred){
                success = options.success || function(){};
                error = options.error || function(){};
                this.pushDeferred.done(success).fail(error);
            } else {
                this.pushDeferred = Backbone.$.Deferred();
                success = function(){
                    that.pushDeferred.resolveWith(options, arguments);
                    setTimeout(function(){
                        delete that.pushDeferred;
                    }, that.minimumTime);
                    if(options.success)
                        options.success.apply(options, arguments);
                };
                error = function(){
                    that.pushDeferred.resolveWith(options, arguments);
                    delete that.pushDeferred;
                    if(options.error)
                        options.error.apply(options, arguments);
                };
                var helper = function(){
                    var pushingItems = that.collection.items.filter(function(item){
                        return item.dirty === true || that.storage.matchClientId(item.id);
                    });
                    success = _.after(pushingItems.length + 1, success); //1 for the deletedItems call
                    _.each(pushingItems,
                           function(element, index, list){
                               that.pushItem(element, {
                                   error: error,
                                   success: success
                               });
                           });
                
                    that.storage.deletedItems(function(recs){
                        var newSuccess = _.after(recs.length, success); //Yes, that's right, two layers of _.after
                        for(var x = 0; x < recs.length; x++){
                            that.flushItem(recs[x], newSuccess);
                    }
                        
                    });
                };

                if(options.ignoreDependencies){
                    helper();
                } else {
                    this.syncDependencies({
                        success: helper,
                        error: options.error
                    });
                }
            }

        };

        this.pushItem = function(item, options){
            //console.log("pushItem: ", item, options);
            options = options || {};
            var error = options.error || function() {};
            var success = options.success || function() {};
            var oldAttrs = _.clone(item.attributes);
            var newAttrs = _.clone(oldAttrs);
            var localId = item.id;
            if(this.storage.matchClientId(item.id)){
                var method = 'create';
                
                delete item.id;
                delete newAttrs[item.idAttribute];
            } else {
                var method = 'update';
            }
            item.clear({silent: true});
            item.set(newAttrs, {silent: true});

            //Note: This method causes the "request" event to have a model with a blank
            //id rather than the client id if new. Since the id is used to generate the request url
            //you can't set the model id any later than it is without changing all the
            //models or collections to calculate urls differently.
            this.ajax(method, item, {
                success: function(model, status, opts){
                    item.id = localId;
                    item.dirty = false;
                    item.save(model, {local: true,
                                      success: success,
                                      wait: true});
                    
                }});
            //Restore the attributes, including the id.
            item.set(oldAttrs, {silent: true});
        };

        //Deletes data on the server and removes it from Web SQL
        this.flushItem = function(id, success){
            //console.log("flushItem: ", id, success);
            success = success || function() {};
            var that = this;
            var model = this.collection.fakeModel(id);
            this.ajax('delete', model, {
                success: function(model, response, opts){
                    that.storage.remove(id);
                    success();
                },
                error: function(jqXHR, textStatus, errorThrown){
                    if(errorThrown === 'Not Found'){
                        //This is just as good as deleting
                        that.storage.remove(id);
                        success();
                    }
                }
            });
        };
        
        
    };
    Offline.Sync = Sync;

    //Wraps the storage collection, which is saved as "items"
    function Collection(items){
        this.items = items;

        //Dirty client-side objects
        this.dirty = function(){
            this.items.filter(function(item){return item.dirty === true;});
        };

        //Destroy items that exist on the client side but not on the server
        this.destroyDiff = function(response){
            var that = this;
            var diff = _.difference(_.filter(this.items.map(function(model){return model.id;}), function (id) {
                return !that.items.storage.matchClientId(id);
            }),
                                    _.pluck(response, 'id'));
            for(var x = 0; x < diff.length; x++){
                var id = diff[x];
                if(id)
                    this.items.get(id).destroy({local:true});
            }
        };

        //Fake model for deleting models from the server by sid
        this.fakeModel = function(sid){
            var model = new Backbone.Model({id: sid});
            model.urlRoot = this.items.url;
            return model;
        };
    };
    Offline.Collection = Collection;
})(_, Backbone);
