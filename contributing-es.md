# Contribuir a KNX.ts

En primer lugar, ¡gracias por considerar contribuir a `KNX.ts`! Personas como tú hacen que esta herramienta sea cada vez mejor para la comunidad de domótica y desarrolladores de KNX.

Este documento contiene un conjunto de pautas e instrucciones para ayudarte a comenzar a contribuir. Por favor, tómate un momento para revisarlas antes de enviar tu contribución.

---

## Tabla de Contenidos

- [Código de Conducta](#código-de-conducta)
- [¿Cómo puedo contribuir?](#cómo-puedo-contribuir)
  - [Reportar Errores (Bugs)](#reportar-errores-bugs)
  - [Sugerir Mejoras](#sugerir-mejoras)
  - [Pull Requests](#pull-requests)
  - [Estilo de desarrollo](#estilo-de-desarrollo)
- [Configuración del Entorno de Desarrollo](#configuración-del-entorno-de-desarrollo)
  - [Requisitos Previos](#requisitos-previos)
  - [Instalación](#instalación)
  - [Compilar el Proyecto](#compilar-el-proyecto)
  - [Formato y Linting](#formato-y-linting)
- [Pautas de Pruebas (Testing)](#pautas-de-pruebas-testing)
  - [Ejecutar Pruebas Unitarias](#ejecutar-pruebas-unitarias)
  - [Ejecutar Pruebas de Estabilidad e Integración](#ejecutar-pruebas-de-estabilidad-e-integración)
  - [Ejecutar Pruebas Manuales con Hardware](#ejecutar-pruebas-manuales-con-hardware)
- [Estructura del Directorio del Proyecto](#estructura-del-directorio-del-proyecto)
- [Pruebas de Integración con Hardware y ETS](#pruebas-de-integración-con-hardware-y-ets)

---

## Código de Conducta

Nuestro objetivo es fomentar un ambiente abierto, acogedor y colaborativo. Por favor, sé respetuoso, constructivo y paciente cuando interactúes con otros colaboradores y mantenedores.

---

## ¿Cómo puedo contribuir?

### Reportar Errores (Bugs)

Antes de enviar un informe de error, comprueba la sección de [Issues](https://github.com/Wesxt/KNX.ts/issues) para verificar si el problema ya ha sido reportado.

Si encuentras un error nuevo, abre un issue e incluye:
- Un título claro y descriptivo.
- Pasos detallados para reproducir el problema.
- **Detalles de tu configuración de hardware**: Dado que KNX depende en gran medida del hardware físico, especifica:
  - La interfaz utilizada (por ejemplo, interfaz IP Tunneling, IP Router, interfaz USB HID, o pasarela serial TPUART).
  - El modelo del dispositivo físico (por ejemplo, Zennio MAXinBOX, Siemens, etc.).
- Comportamiento esperado frente al comportamiento real.
- Logs de depuración (¡los logs de nuestro custom logger son de gran ayuda!).
- Fragmento de código o configuración relevante.

### Sugerir Mejoras

Siempre estamos buscando mejorar la rigurosidad del protocolo, la estabilidad y el soporte de nuevas características (como DPTs, modos de programación, capas NPDU/TPDU). Para sugerir una mejora:
- Revisa las issues/PRs existentes para ver si ya está planificada.
- Explica el caso de uso y por qué esta característica es útil.
- Proporciona ejemplos de cómo debería verse la nueva API o comportamiento.

### Pull Requests

1. Haz un fork del repositorio y crea tu rama desde `main`.
2. Escribe código limpio y legible siguiendo las pautas de estilo del proyecto.
3. Agrega o actualiza las pruebas según corresponda.
4. Asegúrate de que todas las reglas de lint y pruebas pasen correctamente.
5. Envía un pull request con un título descriptivo y una explicación detallada de los cambios.

### Estilo de desarrollo

El estilo se centra en POO para separar cada adstracción o piezas del protocolo en su propia clase, ejemplos como la implementación del EMI o CEMI demuestran esto, la desventaja es claramente una falta del patron de desarrollo DRY (Don't repeat yourself) y más WET (Write Everything Twice o We Enjoy Typing), la ventaja es que es mucho más facil de leer, comprender y desarrollar el código atravez de los docs de la especificación KNX, es mucho más facil prototipar algo como el CEMI que aplicarle ingeniería DRY para hacer estandares o patrones recurrentes que dificultan la depuración y manejo de errores.

Escriba comentarios que expliquen el manejo de bits siempre que sea posible o confunso de implementar, un ejemplo de esto es el APCI debido a que se escriben 10 bits en dos bytes separados se explica con comentarios los pasos y partes de este.

Apesar de afirmar y de centrarse en el rendimiento de la librería hay tecnicas que se evitan de usar por temas de seguridad o facil desarrollo, por ejemplo los metodos como `Buffer.allocUnsafe()` o Buffers con dos punteros.

Evite abreviar nombres a variables y funciones a menos que sea parte de la especificación.

No cree funciones que hagan operaciones de bits, esto crea confusión donde no debería es mucho más simple y entendible usar operadores como `&` o `|` o los metodos de `Buffer`.

---

## Configuración del Entorno de Desarrollo

### Requisitos Previos

- **Node.js**: (se recomienda Node.js v18 o superior)
- **Herramientas de compilación C/C++**: Requeridas en algunos sistemas operativos para compilar módulos nativos (`node-hid` y `serialport`).
  - **Linux**: `sudo apt-get install build-essential libudev-dev`
  - **macOS**: Xcode Command Line Tools.
  - **Windows**: Visual Studio Build Tools con la carga de trabajo de desarrollo para el escritorio con C++.

### Instalación

Clona el repositorio e instala las dependencias:

```bash
git clone https://github.com/Wesxt/KNX.ts.git
cd KNX.ts
npm install
```

### Compilar el Proyecto

El proyecto se compila usando el compilador de TypeScript:

```bash
# Compilación única
npm run build

# Modo watch (observador) para desarrollo activo
npm run watch
```

### Formato y Linting

Forzamos un estilo de código limpio usando ESLint y Prettier. Asegúrate de que tu código pase las comprobaciones antes de enviarlo:

```bash
# Ejecutar linting
npx eslint src/
```

> [!NOTE]
> Asegúrate de que tu IDE (como VS Code) esté configurado para usar la configuración local de `.prettierrc` para formatear al guardar.

---

## Pautas de Pruebas (Testing)

Tenemos diferentes niveles de pruebas según si tienes acceso a hardware KNX físico.

### Ejecutar Pruebas Unitarias

Las pruebas unitarias no requieren hardware físico y simulan los canales de comunicación. Puedes ejecutarlas usando Jest:

```bash
npm run test
```

### Ejecutar Pruebas de Estabilidad e Integración

Estos scripts ejecutan sesiones más largas para probar la robustez de la conexión y el secuenciamiento, especialmente para la emulación de pasarela ETS:

```bash
# Probar estabilidad de la conexión tunneling
npm run test:stability

# Probar estabilidad del host del servidor tunneling
npm run test:server-stability
```

### Ejecutar Pruebas Manuales con Hardware

Disponemos de scripts de prueba manuales específicos dentro del directorio `manual-tests/` para probar las interfaces.

> [!WARNING]
> Ejecutar estas pruebas requiere hardware físico (interfaz USB, adaptador TPUART, IP Router/Interface) conectado a tu red o máquina local.

Puedes ejecutar pruebas manuales específicas a través de `tsx`:

```bash
# Prueba manual del Router
npm run manualTest:router

# Prueba manual de conexión Tunneling
npm run manualTest:tunneling

# Prueba manual de enrutamiento Multicast
npm run manualTest:routing

# Prueba manual de interfaz USB HID
npm run manualTest:usb

# Prueba manual de enrutamiento USB
npm run manualTest:routingUsb

# Prueba manual de interfaz serial TPUART
npm run manualTest:tpuart
```

---

## Estructura del Directorio del Proyecto

Aquí tienes un breve resumen de los directorios clave del proyecto:

- `src/`: Archivos fuente principales en TypeScript.
- `test/`: Suites de pruebas automatizadas y marcos de pruebas de estabilidad.
- `manual-tests/`: Scripts de verificación manual utilizando equipos físicos de KNX.
- `eslint.config.mjs` / `.prettierrc`: Configuraciones de linting y estilo de código.
- `TODO.md`: Hoja de ruta y características experimentales actualmente en desarrollo.

---

## Pruebas de Integración con Hardware y ETS

### KNXnetIPServer

- Procure no tener reglas de firewall sobre la ip broadcast.
- Si tiene problemas para recibir mensajes, desactive la opcion `useAllInterfaces` y/o revise la disponibilidad del puerto
- Los clientes deben estar en la misma subred para conectarse
- Si tiene dispositivos KNX Router deben estar en la misma ip broadcast para enrutar mensajes.
- Evite configurar las direcciones fisicas de los clientes y del propio KNXnetIPServer ya existentes en la topologia KNX.
- Si tiene dispositivos USB o TPUART o KNX IP Interface y quiere enrutar sus mensajes atraves de KNXnetIPServer use la clase `Router` y configure las conexiones.
- El software ETS puede descubrir el KNXnetIPServer automaticamente por lo tanto puede conectarse y usar las funciones Monitor de Grupos, Busmonitor (tiene bugs), Descubrir dispositivos en modo programación, Descubrir direccion individual, Escaneo de linea y Programación y Desprogramación de dispositivos.

### KNXTunneling

- Se puede conectar a un dispositivo KNX IP Interface o un KNX Router siempre y cuando tengan disponibilidad en sus conexiones simultaneas
- Cada vez que quiera detener un servicio que use KNXTunneling use siempre el metodo de desconexión `disconnect()` antes de dentenerlo para evitar que siga usando un slot de conexión simultanea de un dispositivo KNXnet/IP, esto solo sucede en conexión UDP en TCP no importa tanto.
- Puede programar dispositivos siempre y cuando el dispositivo KNXnet/IP al que se conecta tenga esa capacidad.

### KNXUSB (USB HID)

- Si usted está en linux debe unirse al grupo `plugdev` para tener permisos sobre los dispositivos USB HID, procure crear reglas `udev` para estar en el grupo de forma permanente.
- El KNXUSB intentará conectarse automaticamente a un dispositivo USB que esté dentro de su lista de fabricantes conocidos, si no lo encuentra usted mismo debe configurarle el vendor ID, product ID y la ruta del puerto.
- KNXUSB una ves conectado detectará primero si el dispositivo usa EMI o CEMI, una vez detectado eso empesará a recibir mensajes, si el dispositivo usa EMI entonces intentará siempre convertirlo a CEMI los mensajes entrantes y los salientes de CEMI a EMI.

### TPUART

- Si usa una Rasberry Pi active el puerto serial en sus configuración y desactive el bluetooth para dejar el puerto `/dev/ttyAMA0` libre.
- Debe unirse al grupo `dialout` para tener permisos sobre los puertos seriales.
- El TPUART usualmente usa mensajes EMI por lo tanto los mensajes salientes se convierten de CEMI a EMI y viceversa cuando son entrantes.
- Debe tener en cuenta que el baudrate que usa en la conexión TPUART es de 19200 apesar de que el BUS KNX es de 9600, por alguna razón que desconosco se tuvo que configurar así por problemas de parseo de mensajes pero si tiene problemas aún asi intente cambiar el baudrate.
