describe("Offline", function(){

    beforeEach(function(){
        jasmine.Ajax.useMock();
        testCollection = new TestCollection();
    });

    afterEach(function(){
        testCollection.storage.clear();
        delete testCollection;
    });
    
    it("should be defined", function() {
        expect(Offline).toBeDefined();
    });

    it("should redefine Backbone.sync", function(){
        expect(Backbone.sync).toBe(Offline.sync);
    });

    describe(".onLine", function(){

        beforeEach(function(){
            this.onLine = window.navigator.onLine;
        });

        afterEach(function(){
            window.navigator.onLine = this.onLine;
        });
        
        it("should return true when onLine is undefined", function(){
            window.navigator = {};
            expect(Offline.onLine()).toBeTruthy();
        });

        it("should return true when onLine is true", function(){
            window.navigator.onLine = true;
            expect(Offline.onLine()).toBeTruthy();
        });

        it("should return false when onLine is false", function(){
            window.navigator.onLine = false;
            expect(Offline.onLine()).toBeFalsy();
        });
        
    });

    describe('.localSync', function(){
        beforeEach(function(){
            storage = testCollection.storage;
            testModel = testCollection.create();
            //mostRecentAjaxRequest().response(TestResponses.getModel.success);
        });

        afterEach(function(){
            delete storage;
            delete testModel;
        });

        it('should call "findAll" when reading collection', function(){
            spyOn(storage, 'findAll');
            testCollection.fetch();
            expect(storage.findAll).toHaveBeenCalledWith(jasmine.any(Object));
        });

        it('should call "find" when reading model with id', function(){
            spyOn(storage, 'find');
            testModel.id = 1;
            testModel.fetch();
            expect(storage.find).toHaveBeenCalled();
        });

        it('should call "create" when creating model', function(){
            spyOn(storage, 'create');
            testCollection.create({name: 'new model'});
            expect(storage.create).toHaveBeenCalled();
        });

        it('should call "destroy" when deleting model with id', function(){
            spyOn(storage, 'destroy');
            testModel.id = 1;
            testModel.destroy();
            expect(storage.destroy).toHaveBeenCalled();
        });

        it('should call "options.success" when saving', function(){
            var success = jasmine.createSpy("Success Callback");
            runs(function(){
                testModel.save({name: "Test model"}, {success: success});
            });

            waitsFor(function(){
                return success.calls.length == 1;
            });

            runs(function(){
                expect(success).toHaveBeenCalled();
            });
        });
        
    });

    describe('.sync', function(){
        it('should use old sync if storage is not defined on the collection', function(){
            spyOn(Backbone, 'ajaxSync');
            var storage = testCollection.storage;
            testCollection.storage = null;
            testCollection.create({name: "New Model"});
            expect(Backbone.ajaxSync).toHaveBeenCalled();
            testCollection.storage = storage;
        });
    });
    

});

describe("Storage", function(){
    beforeEach(function(){
        jasmine.Ajax.useMock();
        testCollection = new TestCollection();
        storage = testCollection.storage;
    });
    
    afterEach(function(){
        testCollection.storage.clear();
        delete storage;
        delete testCollection;
    });

    it('should be defined', function(){
        expect(Offline.Storage).toBeDefined();
    });


    describe('.destroy', function(){
        it('should call success after deleting', function(){
            var success = jasmine.createSpy("Success Callback");
            runs(function(){
                testCollection.create({Name: "Test Model"}, {
                    success: function(model, resp, options){
                        model.destroy({success: success});
                    }});
            });

            waitsFor(function(){
                return success.calls.length == 1;
            });

            runs(function(){
                expect(success).toHaveBeenCalled();
            });
            
        });
    });

    describe('.find', function(){
        it('recovers a model after it has been saved', function(){
            var recoveredModel;
            var newModel;
            runs(function(){
                newModel = testCollection.create({Name: "Test Model"}, {success: function(model, resp, options){
                    storage.find(newModel, {
                        success: function(resp, status, options){
                            recoveredModel = _.isEqual(resp, newModel.attributes);
                        }});
                }});
                
            });

            waitsFor(function(){
                return recoveredModel;
            });

            runs(function(){
                expect(recoveredModel).toBeTruthy();
            });
        });

        it('does not find a model after deletion', function(){
            var error = jasmine.createSpy("Error Callback");
            var success = jasmine.createSpy("Success Callback");
            var newModel;
            
            runs(function(){
                newModel = testCollection.create({Name: "Test Model"}, {success: function(model, resp, options){
                    newModel.destroy({
                        success: function(model, resp, options){
                            storage.find(newModel, {success: success, error: error});
                        }
                    });
                }});
            });

            waitsFor(function(){
                return (error.calls.length + success.calls.length) > 0;
            });

            runs(function(){
                expect(error).toHaveBeenCalled();
            });
        });
    });

    describe('.save', function(){
        it('sets the result to dirty if new', function(){
            var newModel;
            runs(function(){
                newModel = testCollection.create({Name: "Test Model"});
            });

            waitsFor(function(){
                return newModel.dirty == true;
            });

            runs(function(){
                expect(newModel.dirty).toBeTruthy();
            });
        });

        it('saves modified items that are not new', function(){
            var newModel;
            var sentinel;
            
            runs(function(){
                newModel = testCollection.create({Name: "Test Model"}, {success: function(model, resp, options){
                    model.save({newAttr: "baz"}, {
                        success: function(model, resp, options){
                            storage.find(model, {
                                success: function(resp, status, options){
                                    sentinel = resp.newAttr == "baz";
                                }
                            });
                        }
                    });
                }});
    
            });

            waitsFor(function(){
                return sentinel;
            });

            runs(function(){
                expect(sentinel).toBeTruthy();
            });
        });

        it('makes it possible to run get on collection after creation', function(){
            var newModel;
            var sentinel;
            
            runs(function(){
                newModel = testCollection.create({Name: "Test Model"}, {success: function(model, resp, options){
                    model.save({newAttr: "baz"}, {
                        success: function(model, resp, options){
                            sentinel = true;
                        }
                    });
                }});
    
            });

            waitsFor(function(){
                return sentinel;
            });

            runs(function(){
                expect(testCollection.get(newModel.id)).toBe(newModel);
            });
            
        });
        it('should set dirty to false when items added from server', function(){
            var sentinel;

            runs(function(){
                testCollection.storage.sync.pull({success: function(){
                    sentinel = true;                
                }});
                mostRecentAjaxRequest().response(TestResponses.getThreeModels.success);
            });

            waitsFor(function(){
                return sentinel;
            });

            runs(function(){
                expect(testCollection.at(0).dirty).toBeFalsy();
            });
        });

    });

    describe('.isDeleted', function(){
        it('calls false callback for live item and true for destroyed item', function(){
            var newModel;
            var trueCB = jasmine.createSpy("True Callback");
            var falseCB = jasmine.createSpy("False Callback");
            
            runs(function(){
                newModel = testCollection.create({Name: "Test Model"}, {
                    success: function(model, resp, options){
                        model.set({id:123}) ;
                        model.save({}, {
                            success: function(model, resp, options){
                                storage.isDeleted(model.id, trueCB, falseCB);
                                model.destroy({
                                    success: function(model, resp, options){
                                        storage.isDeleted(model.id, trueCB, falseCB);
                                    }
                                });
                            }
                        });
                        
                        
                    }});
                
            });
            
            waitsFor(function(){
                return (trueCB.calls.length + falseCB.calls.length) > 1;
            });

            runs(function(){
                expect(trueCB.calls.length).toBe(1);
                expect(falseCB.calls.length).toBe(1);
            });
        });

        it('calls false callback for item not on server', function(){
            var falseCB = jasmine.createSpy("False Callback");
            runs(function(){
                storage.isDeleted("111", undefined, falseCB);
            });

            waitsFor(function(){
                return falseCB.calls.length > 0;
            });

            runs(function(){
                expect(falseCB.calls.length).toBe(1);
            });
            
            
        });
    });

    describe('.deletedItems', function(){
        it('calls callback with a deleted item', function(){
            var newModel;
            var success = jasmine.createSpy("Success Callback");

            
            runs(function(){
                newModel = testCollection.create({Name: "Test Model"}, {
                    success: function(model, resp, options){
                        model.set({id: 123});
                        model.save({}, {
                            success: function(model, resp, options){
                                model.destroy({
                                    success: function(model, resp, options){
                                        storage.deletedItems(success, undefined);
                                    }
                                });
                            }
                        });
                        
                }});
    
            });

            waitsFor(function(){
                return (success.calls.length) > 0;
            });

            runs(function(){
                expect(success.calls[0].args[0]).toEqual([123]);
            });
        });

        it('calls callback with empty array if no deleted items', function(){
            var success = jasmine.createSpy("Success Callback");
 
            runs(function(){
                storage.deletedItems(success, undefined);
            });
            
            waitsFor(function(){
                return (success.calls.length) > 0;
            });

            runs(function(){
                expect(success.calls[0].args[0]).toEqual([]);
            });
            
        });
    });

    describe('.findAll', function(){
        it('with options.local returns a model added to the database', function(){
            var newModel;
            var sentinel;
            
            runs(function(){
                newModel = testCollection.create({Name: "Test Model"}, {
                    success: function(model, resp, options){
                        storage.findAll({
                            local: true,
                            success: function(collection, resp, options){
                                sentinel = collection;
                            }
                        });
                        
                    }});
    
            });

            waitsFor(function(){
                return sentinel;
            });

            runs(function(){
                expect(sentinel).toContain(newModel.attributes);
            });
        });
        it('with options.local ignores a model deleted from the database', function(){
            var newModel;
            var sentinel;
            
            runs(function(){
                newModel = testCollection.create({Name: "Test Model"}, {
                    success: function(model, resp, options){
                        model.destroy({
                            success: function(){
                                storage.findAll({
                                    local: true,
                                    success: function(model, resp, options){
                                        sentinel = model;
                                    }
                                });
                            }
                        });
                    
                }});
    
            });

            waitsFor(function(){
                return sentinel;
            });

            runs(function(){
                expect(sentinel).toEqual([]);
            });
        });
        it('calls full sync if the table is empty', function(){
            spyOn(storage.sync, 'full');

            runs(function(){
                storage.findAll();
            });

            waitsFor(function(){
                return storage.sync.full.calls.length > 0;
            });

            runs(function(){
                expect(storage.sync.full).toHaveBeenCalledWith(jasmine.any(Object));
            });
            
        });

    });

    describe('.isEmpty', function(){
        it('calls true callback if table is empty', function(){
            var callback = jasmine.createSpy("True Callback");

            runs(function(){
                storage.isEmpty(callback, undefined);
            });

            waitsFor(function(){
                return callback.calls.length > 0;
            });

            runs(function(){
                expect(callback).toHaveBeenCalled();
            });
        });

        it('calls false callback if table is not empty', function(){
            var callback = jasmine.createSpy("False Callback");

            runs(function(){
                testCollection.create({name: "Test Model"}, {
                    success: function(model, resp, options){
                    storage.isEmpty(undefined, callback);
                }});
            });

            waitsFor(function(){
                return callback.calls.length > 0;
            });

            runs(function(){
                expect(callback).toHaveBeenCalled();
            });
        });
    });

    describe('.remove', function(){
        var sentinel;
        
        it('removes an item that has been created in the database', function(){
            testCollection.create({name: "Test Model"}, {
                success: function(model, resp, options){
                    storage.remove(model, {
                        success: function(){
                            storage.isEmpty(function(){
                                sentinel = true;
                            });
                        }
                    });
                }
            });
        });

        waitsFor(function(){
            return sentinel;
        });

        runs(function(){
            expect(sentinel).toBeTruthy();
        });
    });

    describe('.clear', function(){
        
        it('deletes an item that has been created in the database', function(){
            var sentinel;
            runs(function(){
                testCollection.create({name: "Test Model"}, {
                    success: function(model, resp, options){
                        storage.clear(function(){
                            storage.isEmpty(function(){
                                sentinel = true;
                            });
                        });
                    }});
            });
            waitsFor(function(){
                return sentinel;
            });
            
            runs(function(){
                expect(sentinel).toBeTruthy();
            });
        });

    });

});

describe("Sync", function(){
    beforeEach(function(){
        jasmine.Ajax.useMock();
        testCollection = new TestCollection();
        storage = testCollection.storage;
        sync = testCollection.storage.sync;
    });
    
    afterEach(function(){
        testCollection.storage.clear();
        delete storage;
        delete testCollection;
        delete sync;
    });
    
    it('should be defined', function(){
        expect(Offline.Sync).toBeDefined();
    });

    describe('.ajax', function(){

        it('should run incremental when online is undefined', function(){
            spyOn(sync, 'incremental');

            runs(function(){
                sync.ajax('GET', new TestModel({id:1}, {collection: testCollection}), {});
                mostRecentAjaxRequest().response(TestResponses.getModel.success);

            });

            waitsFor(function(){
                return sync.incremental.calls.length > 0;
            });
            
            runs(function(){
                expect(sync.incremental).toHaveBeenCalled();
            });

        });

        it('should not run incremental when online is true', function(){
            spyOn(sync, 'incremental');
            sync.online = true;
            var sentinel;
            
            runs(function(){
                sync.ajax('GET', new TestModel({id:1}, {collection: testCollection}), { success: function(){sentinel=true;}});
                mostRecentAjaxRequest().response(TestResponses.getModel.success);

            });

            waitsFor(function(){
                return sentinel;
            });
            
            runs(function(){
                expect(sync.incremental).not.toHaveBeenCalled();
            });

        });
        
    });

    describe('.full', function(){
        it('should fill the collection from a response', function(){
            var sentinel;

            runs(function(){
                sync.full({success: function(){sentinel = true;}});
                mostRecentAjaxRequest().response(TestResponses.getThreeModels.success);

            });

            waitsFor(function(){
                return sentinel;
            });

            runs(function(){
                expect(testCollection.length).toEqual(3);
            });
        });

        it('should call error callback with xhr', function(){
            var sentinel;
            var error = jasmine.createSpy("Error Callback");

            runs(function(){
                sync.full({
                    error: error
                });
                mostRecentAjaxRequest().response(TestResponses.getModel.error);
            });

            waitsFor(function(){
                return error.calls.length > 0;
            });

            runs(function(){
                expect(error).toHaveBeenCalled();
            });
        });

        it('should clear anything already in the collection', function(){
            var sentinel;

            runs(function(){
                testCollection.create({name: "Test Model"}, {
                    success: function() {
                        sync.full({success: function(){sentinel = true;}});
                        mostRecentAjaxRequest().response(TestResponses.getThreeModels.success);
                    }
                });
            });

            waitsFor(function(){
                return sentinel;
            });

            runs(function(){
                expect(testCollection.length).toEqual(3);
            });
        });
    });

    describe('.pull', function(){
        it('should add server items to the collection', function(){
            var sentinel;

            runs(function(){
                testCollection.create({name: "Test Model"}, {
                    success: function(){
                        sync.pull({success: function(){sentinel = true;}});
                        mostRecentAjaxRequest().response(TestResponses.getThreeModels.success);
                    }
                });
            });

            waitsFor(function(){
                return sentinel;
            });

            runs(function(){
                expect(testCollection.length).toEqual(4);
            });
        });
    });

    describe('.pullItem', function(){
        it('should call updateItem if there is already a model with a matching sid', function(){
            spyOn(sync, 'updateItem');
            var sentinel;
            runs(function(){
                testCollection.create({name: "Test Model"}, {
                    success: function(model, resp, options){
                        model.set('id', 14);
                        sync.pullItem({id: 14, name: "Test Model 2"});
                        sentinel = true;
                    }
                });
            });

            waitsFor(function(){
                return sentinel;
            });

            runs(function(){
                expect(sync.updateItem).toHaveBeenCalled();
            });

        });
        
    });

    describe('.createItem', function() {
        it('does nothing if the item is awaiting deletion', function(){

            var sentinel;
            
            runs(function(){
                testCollection.create({name: "Test Model", id: 143}, {
                    success: function(model, resp, options){
                        model.destroy({
                            success: function(){
                                sync.createItem({id: 143}, function(){
                                    storage.findAll({
                                        success: function(coll, resp, options){
                                            sentinel = coll.length;
                                        },
                                        local: true
                                    });
                                });
                            }
                        });
                    },
                    local: true
                });
            });
            waitsFor(function(){
                return !_.isUndefined(sentinel);
            });
            runs(function(){
                expect(sentinel).toEqual(0);
            });
        });

        it('creates an item from the server with right sid', function(){
            var newModel;
            
            runs(function(){
                sync.createItem({foo: "bar", id: 1337}, function(model, resp, options){
                    newModel = model;
                });
            });

            waitsFor(function(){
                return newModel;
            });

            runs(function(){
                expect(newModel.id).toEqual(1337);
            }); 
        });
        
    });

    describe('.updateItem', function(){
        it('updates a local item if the server item is newer', function(){
            var sentinel;
            var newModel;
            runs(function(){
                testCollection.create({name: "Test Model"}, {
                    success: function(model, resp, options){
                        newModel = model;
                        var now = new Date();
                        //This can happen so fast that it looks like the same time...
                        now.setSeconds(now.getSeconds() + 1);
                        var time = (new Date()).toJSON();
                        sync.updateItem({id: 1337, name: "New Model", updated_at: time},
                                       model,
                                       function(){
                                           sentinel = true;
                                       });
                    }
                });
            });
            waitsFor(function(){
                return sentinel;
            });
            runs(function(){
                expect(newModel.get("name")).toEqual("New Model");
            });
            
        });

        it('doesn\'t update a local item if the server item is older', function(){
            var sentinel;
            var newModel;
            runs(function(){
                testCollection.create({name: "New Model"}, {
                    success: function(model, resp, options){
                        newModel = model;
                        model.sid = 1337;
                        var time = (new Date("1970-03-07T02:43:20+00:00")).toJSON();
                        sync.updateItem({id: 1337, name: "Outdated Model", updated_at: time},
                                       model,
                                       function(){
                                           sentinel = true;
                                       });
                    }
                });
            });
            waitsFor(function(){
                return sentinel;
            });
            runs(function(){
                expect(newModel.get("name")).toEqual("New Model");
            });
            
        });
        
    });

    describe('.push', function(){
        it('calls pushItem on local items', function(){
            spyOn(sync, 'pushItem');

            runs(function(){
                testCollection.create({name: "Test Model"}, {
                    success: function(model, resp, options){
                        sync.push();
                    }
                });
            });

            waitsFor(function(){
                return sync.pushItem.calls.length > 0;
            });

            runs(function(){
                expect(sync.pushItem.calls[0].args[0].attributes.name).toEqual("Test Model");
            });
            
        });

        it('calls flushItem on local deleted items', function(){

            spyOn(sync, 'flushItem');
            var id;
            
            runs(function(){
                testCollection.create({name: "Test Model", id: 1337}, {
                    local: true,
                    success: function(model, resp, options){
                        id = model.id;
                        model.destroy({
                            success: function(){
                                sync.push();
                            }
                        });
                    }
                });
            });

            waitsFor(function(){
                return sync.flushItem.calls.length > 0;
            });

            runs(function(){
                expect(sync.flushItem.calls[0].args[0]).toEqual(1337);
            });
            
        });
    });

    describe('.pushItem', function(){

        beforeEach(function(){
            var sentinel = 0;
            keyCollection = new KeyCollection();
            testCollection2 = new TestCollection({key: keyCollection});
            runs(function(){
                keyCollection.create({id: 123}, { success: function(model){
                    key1 = model;
                }});
                keyCollection.create({id: 321}, {success: function(model){
                    key2 = model;
                }});
            });

            waitsFor(function(){
                if(!(_.isUndefined(window.key1) || (_.isUndefined(window.key2))))
                    return true;
                return false;
            });
            
        });

        afterEach(function(){
            testCollection2.storage.clear();
            keyCollection.storage.clear();
            delete keyCollection;
            delete testCollection2;
            delete key1;
            delete key2;
        });
        


        it('sets keys when a key model is changed', function () {
            var keyModel = keyCollection.create({}, {local: true});
            var model = testCollection2.create({key: keyModel.id}, {local: true});
            keyModel.set("id", 1337);
            expect(model.get("key")).toEqual(1337);
        });

        it('sends new items to the server', function(){
            spyOn(Backbone, 'ajaxSync');
            var newModel;

            runs(function(){
                testCollection.create({name: "Test Model"}, {
                    success: function(model, resp, options){
                        newModel = model;
                        sync.pushItem(model);
                    }
                });
            });

            waitsFor(function(){
                return Backbone.ajaxSync.calls.length > 0;
            });

           runs(function(){
               expect(Backbone.ajaxSync).toHaveBeenCalledWith("create", newModel, jasmine.any(Object));
               //expect(newModel.id).toBeUndefined();
           });
            
        });

        it('updates existing items on the server with right id', function(){
            spyOn(Backbone, 'ajaxSync');
            var newModel;

            runs(function(){
                testCollection.create({name: "Test Model", id: 1337}, {
                    success: function(model, resp, options){
                        newModel = model;
                        sync.pushItem(model);
                    }
                });
            });

            waitsFor(function(){
                return Backbone.ajaxSync.calls.length > 0;
            });

           runs(function(){
               expect(Backbone.ajaxSync).toHaveBeenCalledWith("update", newModel, jasmine.any(Object));
           }); 
        });

        it('sets the right id for sync event', function(){
            var newModel;
            var newModelId;
            var syncId;
            var count = 0;

            runs(function(){
                testCollection.create({name: "Test Model", id: 1337}, {
                    success: function(model, resp, options){
                        newModel = model;
                        newModelId = model.id;
                        newModel.on('sync', function(model, resp, options){
                            syncId = model.id;
                            count++;
                        });
                        sync.pushItem(model);
                        mostRecentAjaxRequest().response(TestResponses.getModel.success);
                    }
                });
            });

            waitsFor(function(){
                return count > 0;
            });

            runs(function(){
                expect(syncId).toEqual(newModelId);
            });
            
        });
        it('resets the id before the AJAX request', function(){
            spyOn($, 'ajax');
            var newModel;
            var id;

            runs(function(){
                testCollection.create({name: "Test Model"}, {
                    sid: 1337,
                    success: function(model, resp, options){
                        id = model.id;
                        newModel = model;
                        sync.pushItem(model);
                    }
                });
            });

            waitsFor(function(){
                return $.ajax.calls.length > 0;
            });

           runs(function(){
               expect(newModel.id).toEqual(id); //Because the AJAX call never
           }); 
        });

        it('keeps client key ids on the model', function(){

            var id1;
            var id2;
            var id3;
            var request;
            var newModel;
            
            spyOn(testCollection2.storage, 'save').andCallThrough();
            
            runs(function(){
                testCollection2.create({name: "Test Model", key: key1.id}, {
                    success: function(model, resp, options){
                        newModel = model;
                        model.on("request", function(model, xhr, options){
                            id1 = model.get('key');
                        });
                        testCollection2.storage.sync.pushItem(model);
                    }
                });
            });

            waitsFor(function(){
                return id1;
            });

            runs(function(){
                id2 = newModel.get('key');
                mostRecentAjaxRequest().response(TestResponses.keyTestModel.success);
            });

            waitsFor(function(){
                return testCollection2.storage.save.calls.length == 2;
            });

            runs(function(){
                id3 = newModel.get('key');
                //This isn't a functional requirement, more like an unfortunate side effect
                //expect(id1).toEqual(123); 
                expect(id2).toEqual(key1.id);
                expect(id3).toEqual(key1.id);
            });
            
        });
        
    });

    describe('.flushItem', function(){
        it('removes the deleted model from the table', function(){
            var sentinel;
            
            runs(function(){
                testCollection.create({name: "Test Model"},
                                      {sid: 1000,
                                       local: true,
                                       success: function(model, resp, options){
                                           model.destroy({
                                               success: function(){
                                                   sync.flushItem(model.id, model.sid);
                                                   mostRecentAjaxRequest().response(TestResponses.deleteModel.success);
                                               }
                                           });
                                       }
                                      });
            });
            waitsFor(function(){
                storage.isEmpty(function(){
                    sentinel = true;
                });
                return sentinel;
            });
            
            runs(function(){
                expect(sentinel).toBeTruthy();
            });
            
        });
    });

    describe('.getAllDependencies', function(){
        it('includes the key collection\'s sync', function(){
            var keyCollection = new KeyCollection();
            var testCollection2 = new TestCollection({key: keyCollection});

            expect(testCollection2.storage.sync.getAllDependencies()[0] === keyCollection.storage.sync).toBeTruthy();
            
        });

        it('includes the key collection\'s parent\'s sync', function(){
            var keyCollection = new KeyCollection();
            var testCollection2 = new TestCollection({key: keyCollection});
            var testCollection3 = new TestCollection({key: testCollection2});
            

            expect(testCollection3.storage.sync.getAllDependencies()[0] === keyCollection.storage.sync).toBeTruthy();
            
        });
        
    });
    
});

describe('Collection', function(){
    beforeEach(function(){
        jasmine.Ajax.useMock();
        testCollection = new TestCollection();
        storage = testCollection.storage;
    });
    
    afterEach(function(){
        testCollection.storage.clear();
        delete storage;
        delete testCollection;
    });

    describe('.destroyDiff', function(){

        var sentinel;
        var newModel;
        
        it('destroys models that have an sid and aren\'t reflected in a pull response', function(){
            spyOn(storage, 'destroy');
            runs(function(){
                testCollection.create({name: "Test Model", id: 1000}, {
                    local: true,
                    success: function(model, resp, options){
                        newModel = model;
                        storage.sync.collection.destroyDiff([{name: "Test Model 2", id: 1337}]);
                    }
                });
            });

            waitsFor(function(){
                return storage.destroy.calls.length == 1;
            });

            runs(function(){
                expect(storage.destroy).toHaveBeenCalledWith(newModel, jasmine.any(Object));
            });
        });
        
    });
});
