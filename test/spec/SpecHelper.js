var TestResponses = {
    getModel: {
        success: {
            status: 200,
            responseText: '{"id": 1337, "foo":"bar"}'
        },
        error: {
            status: 500,
            responseText: 'Internal Server Error'
        }
    },
    getThreeModels: {
        success: {
            status: 200,
            responseText: '[{"id":20, "name":1},{"id":21, "name":2},{"id":22, "name":3}]'
        }
    },
    keyTestModel: {
        success: {
            status: 200,
            responseText: '{"id": 1000, "key": 123, "name": "New Model"}'
        }
    },
    deleteModel: {
        success: {
            status: 204,
            responseText: ""
        }
    }
};

window.TestModel = Backbone.Model.extend({
    defaults: {
        foo: 'bar'
    }
});

window.TestCollection = Backbone.Collection.extend({
    model: TestModel,
    url: '/api/test_collection',
    initialize: function(keys){
        this.storage = new Offline.Storage('test_collection', this, {keys: keys});
    }
});

window.NoSqlTestCollection = Backbone.Collection.extend({
    model: TestModel,
    url: '/api/test_collection'
});

window.KeyModel = Backbone.Model.extend({
    defaults: {
        name: "Key Model"
    }
});

window.KeyCollection = Backbone.Collection.extend({
    model: KeyModel,
    url: 'api/key_collection',
    initialize: function(keyCollection){
        this.storage = new Offline.Storage('key_collection', this);
    }
});
