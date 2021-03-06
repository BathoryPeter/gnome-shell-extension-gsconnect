'use strict';

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;


function toHyphenCase(string) {
    if (toHyphenCase.__cache === undefined) {
        toHyphenCase.__cache = {};
    }

    if (!toHyphenCase.__cache[string]) {
        toHyphenCase.__cache[string] = string.replace(/(?:[A-Z])/g, (c, i) => {
            return (i > 0) ? '-' + c.toLowerCase() : c.toLowerCase();
        }).replace(/[\s_]+/g, '');
    }

    return toHyphenCase.__cache[string];
}


function _proxyInit(proxy, cancellable = null) {
    if (proxy.__initialized !== undefined) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        proxy.init_async(
            GLib.PRIORITY_DEFAULT,
            cancellable,
            (proxy, res) => {
                try {
                    proxy.init_finish(res);
                    proxy.__initialized = true;
                    resolve();
                } catch (e) {
                    Gio.DBusError.strip_remote_error(e);
                    reject(e);
                }
            }
        );
    });
}


var Device = GObject.registerClass({
    GTypeName: 'GSConnectRemoteDevice',
    Implements: [Gio.DBusInterface],
    Properties: {
        'connected': GObject.ParamSpec.boolean(
            'connected',
            'Connected',
            'Whether the device is connected',
            GObject.ParamFlags.READABLE,
            null
        ),
        'display-type': GObject.ParamSpec.string(
            'display-type',
            'Display Type',
            'A user-visible type string',
            GObject.ParamFlags.READABLE,
            null
        ),
        'encryption-info': GObject.ParamSpec.string(
            'encryption-info',
            'Encryption Info',
            'A formatted string with the local and remote fingerprints',
            GObject.ParamFlags.READABLE,
            null
        ),
        'icon-name': GObject.ParamSpec.string(
            'icon-name',
            'Icon Name',
            'Icon name representing the device',
            GObject.ParamFlags.READABLE,
            null
        ),
        'id': GObject.ParamSpec.string(
            'id',
            'deviceId',
            'The device hostname or other unique id',
            GObject.ParamFlags.READABLE,
            ''
        ),
        'name': GObject.ParamSpec.string(
            'name',
            'deviceName',
            'The device name',
            GObject.ParamFlags.READABLE,
            null
        ),
        'paired': GObject.ParamSpec.boolean(
            'paired',
            'Paired',
            'Whether the device is paired',
            GObject.ParamFlags.READABLE,
            null
        ),
        'type': GObject.ParamSpec.string(
            'type',
            'deviceType',
            'The device type',
            GObject.ParamFlags.READABLE,
            null
        )
    }
}, class Device extends Gio.DBusProxy {

    _init(service, object_path) {
        this._service = service;

        super._init({
            g_connection: service.g_connection,
            g_name: service.g_name,
            g_object_path: object_path,
            g_interface_name: `${service.g_name}.Device`
        });
    }

    // Proxy GObject::notify signals
    vfunc_g_properties_changed(changed, invalidated) {
        try {
            for (let name in changed.deep_unpack()) {
                this.notify(toHyphenCase(name));
            }
        } catch (e) {
            logError(e);
        }
    }

    _get(name, fallback = null) {
        try {
            return this.get_cached_property(name).unpack();
        } catch (e) {
            return fallback;
        }
    }

    get connected() {
        return this._get('Connected', false);
    }

    get display_type() {
        return this._get('DisplayType', '');
    }

    get encryption_info() {
        return this._get('EncryptionInfo', '');
    }

    get icon_name() {
        return this._get('IconName', 'computer');
    }

    get id() {
        return this._get('Id', '0');
    }

    get name() {
        return this._get('Name', 'Unknown');
    }

    get paired() {
        return this._get('Paired', false);
    }

    get settings() {
        if (this._settings === undefined) {
            this._settings = new Gio.Settings({
                settings_schema: gsconnect.gschema.lookup(
                    this.g_interface_name,
                    true
                ),
                path: `${this.g_object_path.toLowerCase()}/${this.id}/`
            });
        }

        return this._settings;
    }

    get service() {
        return this._service;
    }

    get type() {
        return this._get('Type', 'desktop');
    }

    async start() {
        try {
            // Initialize the proxy
            await _proxyInit(this);

            // GActions
            this.action_group = Gio.DBusActionGroup.get(
                this.g_connection,
                this.service.g_name_owner,
                this.g_object_path
            );

            // GMenu
            this.menu = Gio.DBusMenuModel.get(
                this.g_connection,
                this.service.g_name_owner,
                this.g_object_path
            );

            // Subscribe to the GMenu
            await new Promise((resolve, reject) => {
                this.g_connection.call(
                    this.g_name,
                    this.g_object_path,
                    'org.gtk.Menus',
                    'Start',
                    new GLib.Variant('(au)', [[0]]),
                    null,
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    (proxy, res) => {
                        try {
                            resolve(proxy.call_finish(res));
                        } catch (e) {
                            Gio.DBusError.strip_remote_error(e);
                            reject(e);
                        }
                    }
                );
            });
        } catch (e) {
            this.destroy();
            throw e;
        }
    }

    destroy() {
        if (this.__disposed === undefined) {
            this.__disposed = true;

            if (this._settings) {
                this._settings.run_dispose();
                this._settings = null;
            }

            this.run_dispose();
        }
    }
});


var Service = GObject.registerClass({
    GTypeName: 'GSConnectRemoteService',
    Implements: [Gio.DBusInterface],
    Properties: {
        'active': GObject.ParamSpec.boolean(
            'active',
            'Active',
            'Whether the service is active',
            GObject.ParamFlags.READABLE,
            false
        )
    },
    Signals: {
        'device-added': {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [GObject.TYPE_OBJECT]
        },
        'device-removed': {
            flags: GObject.SignalFlags.RUN_FIRST,
            param_types: [GObject.TYPE_OBJECT]
        }
    }
}, class Service extends Gio.DBusProxy {

    _init() {
        super._init({
            g_bus_type: Gio.BusType.SESSION,
            g_name: 'org.gnome.Shell.Extensions.GSConnect',
            g_object_path: '/org/gnome/Shell/Extensions/GSConnect',
            g_interface_name: 'org.freedesktop.DBus.ObjectManager',
            g_flags: Gio.DBusProxyFlags.DO_NOT_AUTO_START_AT_CONSTRUCTION
        });

        this._active = false;
        this._devices = new Map();
        this._starting = false;

        // Watch the service
        this._nameOwnerChangedId = this.connect(
            'notify::g-name-owner',
            this._onNameOwnerChanged.bind(this)
        );
    }

    get active() {
        return this._active;
    }

    get devices() {
        return Array.from(this._devices.values());
    }

    get settings() {
        if (this._settings === undefined) {
            this._settings = new Gio.Settings({
                settings_schema: gsconnect.gschema.lookup(this.g_name, true),
                path: `${this.g_object_path.toLowerCase()}/`
            });
        }

        return this._settings;
    }

    vfunc_g_signal(sender_name, signal_name, parameters) {
        try {
            // Don't emit signals until the ObjectManager has started
            if (!this.active) return;

            parameters = parameters.deep_unpack();

            switch (true) {
                case (signal_name === 'InterfacesAdded'):
                    this._onInterfacesAdded(...parameters);
                    break;

                case (signal_name === 'InterfacesRemoved'):
                    this._onInterfacesRemoved(...parameters);
                    break;
            }
        } catch (e) {
            logError(e);
        }
    }

    /**
     * org.freedesktop.Application.Activate
     *
     * @param {object} platformData - Dictionary of platform data
     * @return {object} - Dictionary of managed object paths and interface names
     */
    _Activate(platformData = {}) {
        return new Promise((resolve, reject) => {
            this.g_connection.call(
                this.g_name,
                this.g_object_path,
                'org.freedesktop.Application',
                'Activate',
                GLib.Variant.new('(a{sv})', [platformData]),
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (proxy, res) => {
                    try {
                        resolve(proxy.call_finish(res));
                    } catch (e) {
                        Gio.DBusError.strip_remote_error(e);
                        reject(e);
                    }
                }
            );
        });
    }

    /**
     * org.freedesktop.DBus.ObjectManager.GetManagedObjects
     *
     * @return {object} - Dictionary of managed object paths and interface names
     */
    _GetManagedObjects() {
        return new Promise((resolve, reject) => {
            this.call(
                'GetManagedObjects',
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                (proxy, res) => {
                    try {
                        let variant = proxy.call_finish(res);
                        resolve(variant.deep_unpack()[0]);
                    } catch (e) {
                        Gio.DBusError.strip_remote_error(e);
                        reject(e);
                    }
                }
            );
        });
    }

    /**
     * org.freedesktop.DBus.ObjectManager.InterfacesAdded
     *
     * @param {string} object_path - Path interfaces have been added to
     * @param {object[]} - list of interface objects
     */
    async _onInterfacesAdded(object_path, interfaces) {
        try {
            // An empty list means only the object has been added
            if (Object.values(interfaces).length === 0) return;

            // Skip existing proxies
            if (this._devices.has(object_path)) return;

            // Create a proxy
            let device = new Device(this, object_path);
            await device.start();

            // Hold the proxy and emit ::device-added
            this._devices.set(object_path, device);
            this.emit('device-added', device);
        } catch (e) {
            logError(e, object_path);
        }
    }

    /**
     * org.freedesktop.DBus.ObjectManager.InterfacesRemoved
     *
     * @param {string} object_path - Path interfaces have been removed from
     * @param {string[]} - List of interface names removed
     */
    _onInterfacesRemoved(object_path, interfaces) {
        try {
            // An empty interface list means the object is being removed
            if (interfaces.length === 0) return;

            // Get the proxy
            let device = this._devices.get(object_path);
            if (device === undefined) return;

            // Release the proxy and emit ::device-removed
            this._devices.delete(object_path);
            this.emit('device-removed', device);

            // Destroy the device and force disposal
            device.destroy();
        } catch (e) {
            logError(e, object_path);
        }
    }

    async _onNameOwnerChanged() {
        try {
            // If the service stopped, remove each device and mark it inactive
            if (this.g_name_owner === null) {
                this._clearDevices();
                this._active = false;
                this.notify('active');

            // If the name is owned, try to query the ObjectManager...
            } else {
                this._active = true;
                this.notify('active');

                let objects = await this._GetManagedObjects();

                for (let [object_path, object] of Object.entries(objects)) {
                    await this._onInterfacesAdded(object_path, object);
                }
            }
        } catch (e) {
            logError(e);
        }
    }

    _clearDevices() {
        for (let [object_path, device] of this._devices) {
            this._devices.delete(object_path);
            this.emit('device-removed', device);
            device.destroy();
        }
    }

    /**
     * Reload all devices without affecting the remote service. This amounts to
     * removing and adding each device while emitting the appropriate signals.
     */
    async reload() {
        try {
            if (this._starting) return;
            this._starting = true;

            this._clearDevices();
            await _proxyInit(this);
            await this._onNameOwnerChanged();

            this._starting = false;
        } catch (e) {
            this._starting = false;
            throw e;
        }
    }

    /**
     * Start the service
     */
    async start() {
        try {
            if (this._starting === false && !this.active) {
                this._starting = true;

                // Ensure the proxy is ready
                await _proxyInit(this);

                // Activate the service if it's not already running
                await this._onNameOwnerChanged();

                if (!this.active) {
                    await this._Activate();
                }

                this._starting = false;
            }
        } catch (e) {
            this._starting = false;
            throw e;
        }
    }

    /**
     * Stop the service
     */
    stop() {
        if (this.active) {
            this.activate_action('quit');
        }
    }

    activate_action(name, parameter = null) {
        try {
            let paramArray = [];

            if (parameter instanceof GLib.Variant) {
                paramArray[0] = parameter;
            }

            let connection = this.g_connection || Gio.DBus.session;

            connection.call(
                this.g_name,
                this.g_object_path,
                'org.freedesktop.Application',
                'ActivateAction',
                GLib.Variant.new('(sava{sv})', [name, paramArray, {}]),
                null,
                Gio.DBusCallFlags.NONE,
                -1,
                null,
                null
            );
        } catch (e) {
            logError(e);
        }
    }

    destroy() {
        if (this._nameOwnerChangedId > 0) {
            this.disconnect(this._nameOwnerChangedId);
            this._nameOwnerChangedId = 0;

            this._clearDevices();
            this._active = false;

            this.run_dispose();
        }
    }
});

