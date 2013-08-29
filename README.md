## Backbone.websqloffline

Backbone.websqloffline is intended to be a more or less drop-in replacement for Backbone.offline, and thus follows the structure of that package, but it stores model data in Web SQL tables instead of in LocalStorage. The motivating use case for developing this plugin was for PhoneGap to develop mobile applications that needed to persist data in a less volatile manner than LocalStorage.

## Requirements

The only library requirements are Backbone and Underscore.

Your models should have an "updated_at" field which is updated by the server on modifications. It should support any attribute as the id with the idAttribute field, but this has not been extensively tested.

## Installation

To use Backbone.websqloffline, add backbone.websqloffline.js to your project. For each collection which you wish to be managed by it, instantiate a new Offline.Storage object at this.storage in the collection initialization. For example:

````
TestCollection = Backbone.Collection.extend({
    model: TestModel,
    url: '/api/test_collection',
    initialize: function(){
        this.storage = new Offline.Storage('test_collection', this});
    }
});
````

The first parameter to Offline.Storage is the table name that will be used in WebSQL and so should be unique for each collection instance which you are managing. The second parameter is a reference to the collection to be managed.

## Usage

Nearly all of the Web SQL functions are asynchronous, and so your application should be structured to take advantage of this with "success" and "error" callbacks included in the options object of your Backbone calls (such as ".save" or ".destroy"). The majority of calls on models and collections will occur locally only, with the major exception being calls to Backbone.Collection.fetch, which syncs the local collection with the server. Updating and creating models will occur locally only.

# Examples
````JavaScript
//Instantiate a local collection
var myCollection = new TestCollection(); 

//Request a full update from the server, calling 
//the successCallback after results are received.

myCollection.fetch({success: successCallback});

//Create a new model, which will be saved to the local
//Web SQL database and have a client-side id assigned 
var model = myCollection.create({name: "Test Model"}); 

//Saves on the model effect only the locally stored copy
model.save({name: "New Name"});
````

To have more fine-grained control of the syncing process, you can use the methods of Offline.Sync by accessing them through the collection.

````JavaScript
//Do a full reload of the collection from the server
//discarding any data on the client side
myCollection.storage.sync.full();

//Incremental requests data from the server and adds
//any newer data, then sends any updated client side
//models to the server, including items marked for
//deletion.
myCollection.storage.sync.incremental();

//Pull pulls all the data from the server and
//overwrites anything older than the local version
//or adds any new items.
myCollection.storage.sync.pull();

//Push uploads to the server any client-side models
//marked as "dirty" or marked for deletion.
myCollection.storage.sync.push();
````

# Other Features

Backbone.websqloffline uses a client-side generated key for models that haven't been saved to the server, which take the form of a UUID with "cid-" prepended so as not to conflict with Mongo and the like, e.g. "cid-00000000-0000-0000-0000-000000000000". When the model is saved to the server it generates a "change:id" event with the new server-side id. The field model.dirty will tell you whether the model is dirty and awaiting upload.

The plugin supports "keys" for collections that have relations to other collections and need ids updated. For example, if you have a collection representing blog posts, and another collection representing users, you may need to associate the blog post with the user that wrote it by storing a user id. To have Backbone.websqloffline translate your client and server keys, instantiate your collections as follows:

````JavaScript
UserCollection = Backbone.Collection.extend({
    model: UserModel,
    url: '/api/users',
    initialize: function(){
        this.storage = new Offline.Storage('users', this});
    }
});

var users = new UserCollection();

BlogPostCollection = Backbone.Collection.extend({
    model: BlogPost,
    url: '/api/blog_posts',
    initialize: function(){
        this.storage = new Offline.Storage('users', this, {keys: {user_id: users}});
    }
});
````

In this case, when the client downloads blog posts from the server, it will replace the user_id attribute of the blog posts (which is a server id for a user) with the client-side id of the user by looking it up in the collection. Whenever a sync is done to a collection that has keys, all of the keys are first synced incrementally with the server recursively, to ensure that their are no problems with matching up keys. It is a bad idea to have cyclical key dependencies, as unexpected behavior could result.

## Contributing

* Bug reports and pull requests are welcome.
* A full set of test cases are available in the test directory. Open spec_runner.html to run the tests.
* Please provide jasmine test cases, if possible.

## Version
* 0.2.0: Significant simplification thanks to elimination of the sid concept, and support for idAttributes other than id.
* 0.1.0: Initial version

## Special Thanks

To Aleksey Kulikov for backbone.offline which was used to structure this package's api.

## License

See LICENSE.
