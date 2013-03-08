// This is a library to use WebSQL to syncrhonize a local long-term datastore with a remote server

(function(_, Backbone){
    //Offline handles the dispatch to storage methods, and acts as a namespace for the other modules
    var Offline = {
        localSync: function(method, model, options, store){
            var resp;
            switch(method){
              case 'read':
                if(_.isUndefined(model.id)){
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
            if(store && store.support)
                Offline.localSync(method, model, options, store);
            else
                Backbone.ajaxSync(method, model, options);
        },

        onLine: function(){
            //This isn't supported in Firefox properly?
            return window.navigator.onLine != false;
        }
    };

 

    Backbone.ajaxSync = Backbone.sync;
    Backbone.sync = Offline.sync;

    window.Offline = Offline;
    
    //Storage provides the interface to Web SQL
    function Storage(name, collection, options){
        options = options || {};
        this.name = name;
        this.collection = collection;
        this.keys = options.keys || {};
        this.autoPush = options.autoPush || false;
        this.support = _.isFunction(window.openDatabase);
        this.sync = new Offline.Sync(collection, this);

        if(!Storage.prototype.db)
            Storage.prototype.db = openDatabase('bb-wsql', '1.0', 'Database for backbone.websqloffline', 1*1024*1024);
        
        this.db = Storage.prototype.db;

        this.db.transaction(function(t){
            t.executeSql("CREATE TABLE IF NOT EXISTS "+ name +" (id INTEGER PRIMARY KEY ASC, sid, dirty, updated_at, deleted, attributes)", [],
                        function(t, r){
                            return;
                        },
                        function(t, e){
                            return;
                        });
        });

        this.create = function(model, options){
            options.regenerateId = true;
            this.save(model, options);
        },
        
        this.update = function(model, options){
            this.save(model, options);
        },

        this.destroy = function(model, options){
            options = options || {};
            var success = options.success || function(){};
            var error = options.error || function(){};
            var that = this;
            
            if(options.local || model.sid === 'new'){
                //Just destroy from database immediately
                this.remove(model, options);
            } else {
                //Just set to deleted in the database
                this.db.transaction(function(t){
                    t.executeSql('UPDATE '+ that.name +' SET deleted = ? WHERE id = ?', [true, model.id],
                                 function(t, resultSet){
                                     model.deleted = true;
                                     success(model, true, options);
                                 },
                                 function(t, e){
                                     error(e);
                                 });
                });                 
            }
        };

        //This function determines whether an item is awaiting deletion from the client-side
        //It is an error to call this function with an sid of "new."
        this.isDeleted = function(sid, trueCallback, falseCallback){
            var that = this;
            if(sid == "new")
                return;
            
            this.db.readTransaction(function(t){
                t.executeSql('SELECT COUNT (*) AS c FROM '+ that.name +' WHERE sid = ? AND deleted = ?', [sid, true],
                             function(t, resultSet){
                                 if(resultSet.rows.item(0).c == 0)
                                     falseCallback();
                                 else
                                     trueCallback();
                             });
            });
        },


        //deletedItems calls its success callback with an array of {id: x, sid: y} objects which
        //map local ids to server ids.
        this.deletedItems = function(success, error){
            var that = this;
            this.db.readTransaction(function(t){
                t.executeSql('SELECT id, sid FROM '+ that.name +' WHERE deleted = ?', [true],
                             function(t, resultSet){
                                 var rows = [];
                                 for(var x = 0; x < resultSet.rows.length; x++){
                                     rows.push(resultSet.rows.item(x));
                                 }
                                 success(rows);
                             },
                             function(t, e){
                                 if(error)
                                     error(e);
                             });
            });
        },

        this.find = function(model, options){
            options = options || {};
            var success = options.success || function(){};
            var error = options.error || function(){};
            var that = this;

            this.db.readTransaction(function(t){
                t.executeSql('SELECT attributes FROM '+ that.name +' WHERE id = ? AND deleted = ?', [model.id, false],
                             function(t, resultSet){
                                 if(resultSet.rows.length > 0){
                                     var result = JSON.parse(resultSet.rows.item(0).attributes);
                                     //id isn't included in the database attributes on first save
                                     result.id = model.id;                                   
                                     success(model, result, options);
                                 }
                                 else
                                     error("Record not found");
                             },
                             function(t, e){
                                 error(e);
                             });
            });
            
        };
        
        this.save = function(item, options){
            options = options || {};
            var success = options.success || function(){};
            var error = options.error || function(){};
            var that = this;
            
            if(!options.local){
                var updated_at = new Date();
                item.set({updated_at: updated_at.toJSON()});
                item.dirty = true;
            }
                
            
            if(options.local){
                //Should only replace keys to local if this is coming from the server
                var newItem = this.replaceKeyFields(item, 'local', error);

                //We don't want to hang around with incorrect keys, so lets set the keys now
                item.set(newItem, {silent: true});
            }
            else if (item.attributes)
                newItem = _.clone(item.attributes);
            else
                newItem = _.clone(item);

            if(_.isUndefined(item.deleted))
                item.deleted = false;

            if(_.isUndefined(item.dirty))
                item.dirty = false;
                
            if(options.regenerateId){
                this.db.transaction(function(t){
                    var sid = item.sid || options.sid || "new";
                    t.executeSql('INSERT INTO '+ that.name +' (sid, dirty, updated_at, deleted, attributes) VALUES (?, ?, ?, ?, ?)',
                                 [sid, item.dirty, item.get('updated_at'), item.deleted, JSON.stringify(newItem)],
                                 function(t,resultSet){
                                     
                                     item.sid = sid;
                                     newItem.id = resultSet.insertId;
                                     success(item, newItem, options);

                                 },
                                function(t, e){
                                    error(e);
                                    item.trigger('error', item, false, options);
                                });
                });
                    
            } else {
                this.db.transaction(function(t){
                    t.executeSql('UPDATE '+ that.name +' SET sid = ?, dirty = ?, updated_at = ?, deleted = ?, attributes = ? WHERE id = ?',
                                 [item.sid, item.dirty, item.get('updated_at'), item.deleted, JSON.stringify(newItem), item.id],
                                function(t,resultSet){
                                    success(item, newItem, options);
                                },
                                function(t, e){
                                    error(e);
                                    item.trigger('error', item, false, options);
                                });
                });
            }
            
            
        };


        //Calls success callback with all of the non-deleted items in the sql table. 
        this.findAll = function(options){
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
                                         fromJson['id'] = resultSet.rows.item(x).id;
                                         jsonResult.push(fromJson);
                                     }
                                     success(null, jsonResult, options);
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
                        //If our store isn't empty, then we will call incremental instead of full,
                        //and we won't wait for it
                        var newOptions = _.clone(options);
                        newOptions.success = function() {
                            options.local = true;
                            that.findAll(options);
                        };
                        that.sync.incremental(newOptions);
                    });
                
            }
        };

        //Calls the callbacks depending on whether we have any items in the clientside table.
        //Even deleted items are included.
        this.isEmpty = function(trueCallback, falseCallback){
            var that = this;
            trueCallback = trueCallback || function(){};
            falseCallback = falseCallback || function(){};
            this.db.readTransaction(function(t){
                t.executeSql('SELECT COUNT(*) AS c FROM '+ that.name, [],
                             function(t, r) {
                                 if(r.rows.item(0).c == 0)
                                     trueCallback();
                                 else
                                     falseCallback();
                             });
            });                          
        };
        
        //Removes an item from the datastore completely
        this.remove = function(item, options){
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
                                     success(item, true, options);
                                 },
                                 function(t, e){
                                     error(e);
                                 });
                });
            }
        };

        //Removes all the items from the table
        this.clear = function(success, error) {
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
            if(item.attributes)
                item = _.clone(item.attributes);
            else
                item = _.clone(item);

            error = error || function(){};
            
            for(var field in this.keys){
                var collection = this.keys[field];
                var replacedField = item[field];
                
                
                if(method == 'local'){
                    var wrapper = new Offline.Collection(collection);
                    //Get the item by sid
                    var replaced = wrapper.get(replacedField);
                    if(replaced)
                        //Replace with local id
                        item[field] = replaced.id;
                    else
                        error(item, "Could not locate matching local id for key");
                } else if(method == 'server'){
                    var replaced = collection.get(replacedField);
                    if(replaced.sid){
                        if(replaced.sid == 'new')
                            error(item, "Could not locate matching sid for key");
                            //Don't know what to do if there is a reference to a 'new' item.
                            //error("Trying to replace client id with new server id");
                        else
                            item[field] = replaced.sid;
                    }
                }
            }
            
            return item;
        };
    };
    Offline.Storage = Storage;

    //Handles the synchronizaiton between client and server datastores
    function Sync(collection, storage){
        this.collection = new Offline.Collection(collection);
        this.storage = storage;

        this.ajax = function(method, model, options){
            if(Offline.onLine()){
                this.prepareOptions(options);
                Backbone.ajaxSync(method, model, options);
            } else {
                this.online = false;
            }
            
        };

        //If the app was offline, we want to schedule an incremental now that it's back online.
        this.prepareOptions = function(options){
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
        this.full = function(options){
            var that = this;
            this.ajax('read', this.collection.items,
                      _.extend({},
                               options,
                               {success: function(model, response, opts){
                                   that.storage.clear(
                                       function(){
                                           
                                           that.collection.items.reset([], {silent: true});
                                           var items = 0;
                                           var responseLength = response.length;
                                           for(item in response){
                                               that.collection.items.create(item, {silent: true, local: true, regenerateId: true,
                                                                                  success: function(){
                                                                                      items++;
                                                                                      if(items == response.length)
                                                                                          that.collection.items.trigger('reset');
                                                                                      if(options.success)
                                                                                          options.success(that.collection, response, opts);
                                                                                  }});    
                                           }
                                       }
                                   );
                               },
                               error: options.error})
                     );
                               
                                       
                                       
        };

        //Performs a pull/push incremental sync
        this.incremental = function(options){
            options = options || {};
            var that = this;
            
            this.pull(_.extend({}, options, {success: function(){
                that.push(options.error);
            }}));
        };


        //Checks the server for new items by downloading the entire collection
        this.pull = function(options){
            options = options || {};
            var that = this;

            this.ajax('read', this.collection.items, _.extend({}, options, {
                success: function(model, response, opts){
                    that.collection.destroyDiff(response);
                    var itemCount = response.length;
                    var x = 0;
                    for(item in response){
                        that.pullItem(item, function(){
                            x++;
                            if(x == itemCount && options.success)
                                //Call callback after processing last item.
                                options.success(that.collection, response, opts);
                        });
                    }
                }}));
            
        };
        
        this.pullItem = function(item, success){
            var local = this.collection.get(item.id);
            if(local)
                this.updateItem(item, local, success);
            else
                this.createItem(item, success);
        };

        this.createItem = function(item, success){
            var that = this;
            
            this.storage.isDeleted(item.id,
                                   function(){
                                       //Is awaiting deletion from our side, do nothing
                                       success();
                                   },
                                   function(){
                                       var sid = item.id;
                                       delete item.id;
                                       that.collection.items.create(item, {local: true, success: success, sid: sid});
                                   });
        };

        this.updateItem = function(item, model, success){
            if(new Date(model.get('updated_at')) < (new Date(item.updated_at))){
                delete item.id;
                model.save(item, {local: true, success: success});
            } else {
                success(model);
            }
        };

        //Uploads dirty client side data and deleted items to the server
        this.push = function(error){
            var that = this;
            var pushingItems = this.collection.items.filter(function(item){return item.dirty == true;});
            _.each(pushingItems,
                   function(element, index, list){
                       that.pushItem(element, error);
                   });
            
            this.storage.deletedItems(function(recs){
                for(var x = 0; x < recs.length; x++){
                    that.flushItem(recs[x].id, recs[x].sid);
                }
                
            });
        };

        this.pushItem = function(item, error){
            var oldAttrs = _.clone(item.attributes);
            var newItem = this.storage.replaceKeyFields(item, 'server', error);
            var localId = item.id;
            if(item.sid == 'new'){
                var method = 'create';
                delete item.id;
                delete newItem.id;
            } else {
                var method = 'update';
                item.id = item.sid;
                newItem.id = item.sid;
            }
            item.clear({silent: true});
            item.set(newItem, {silent: true});
            item.on("request", function(model, xhr, options){
                //We can set the ids and everything back before the request is made to leave
                //the object in a reasonable state during asynchronous calls
                item.set(oldAttrs, {silent: true});
            });
            
            //Note: This method causes the "request" event to have a model with the server
            //id rather than the client id. Since the id is used to generate the request url
            //you can't set the model id any later than it is without changing all the
            //models or controllers to calculate urls with the server id.
            this.ajax(method, item, {
                success: function(model, response, opts){
                    if(method == 'create')
                        item.sid = response.id;
                    response.id = localId;
                    item.id = localId;
                    item.dirty = false;
                    item.save(response, {local: true});
                }});
            
            
        };

        //Deletes data on the server and removes it from Web SQL
        this.flushItem = function(id, sid){
            var model = this.collection.fakeModel(sid);
            this.ajax('delete', model, {
                success: function(model, response, opts){
                    this.storage.remove(id);
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
            this.items.filter(function(item){return item.dirty == true;});
        };

        //Look up items by sid
        this.get = function(sid){
            return this.items.find(function(item){return item.sid == sid;});
        };
        
        //Destroy items that exist on the client side but not on the server
        this.destroyDiff = function(response){
            var diff = _.difference(_.without(this.items.map(function(model){return model.sid;}), 'new'),
                                    _.pluck(response, 'id'));
            for(var x = 0; x < diff.length; x++){
                var sid = diff[x];
                if(this.get(sid))
                    this.get(sid).destroy({local:true});
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