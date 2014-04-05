/* jshint ignore:start */
import animate;
import ui.ViewPool as ViewPool;
import ui.View as View;
import ui.TextView as TextView;
import ui.ImageView as ImageView;
import ui.widget.GridView as GridView;
import ui.resource.Image as Image;
import event.Callback as Callback;

import src.Cell as Cell;
import src.Utils as Utils;
import src.PlayGame as PlayGame;
/* jshint ignore:end */

exports = Class(GridView, function(supr) {
  var startCells = 2;

  this.init = function(opts) {
    var size = 4,
      margin = 10,
      baseSize = opts.baseWidth - 100,
      cellSize = Math.round((baseSize-margin*2)/size) - margin*2;
    baseSize = (cellSize + margin*2) * size + margin*2;
    console.log(cellSize, baseSize);

    merge(opts, {
      layout: 'box',
      centerX: true,
      backgroundColor: Utils.colors.grid,
      width: baseSize,
      height: baseSize,
      rows: size,
      cols: size,
      cellSize: cellSize,
      horizontalMargin: margin,
      verticalMargin: margin,
      autoCellSize: false
    });
    supr(this, 'init', [opts]);
    this.overlay = this.initOverlay(baseSize);

    // init cells with empty data
    var cells = [];
    for (var x = 0; x < this.getRows(); x++) {
      var row = [];
      for (var y = 0; y < this.getCols(); y++) {
        row.push(null);
        new ImageView({
          superview: this,
          row: x,
          col: y,
          width: cellSize,
          height: cellSize,
          image: 'resources/images/cell_blank.png'
        });
      }
      cells.push(row);
    }
    this.cells = cells;

    this.cellPool = new ViewPool({
      ctor: Cell,
      initCount: size*size,
      initOpts: {
        width: cellSize,
        height: cellSize
      }
    });

    GC.app.onPause = bind(this, this.saveGame);

    this.on('ViewDidDisappear', function() {
      this.cellPool.releaseAllViews();
    });

    this.score = opts.score;
  };

  // Hack to get equal border for cells
  this._getInfo = function (list, count, totalSize, gutterSize) {
    var globalScale = this.getPosition().scale,
      opts = this._opts,
      margin = opts.horizontalMargin,
      cellSize = opts.cellSize,
      size = opts.width,
      item, i;

    for (i = 0; i < count; i++) {
      item = list[i];
      if (!item) {
        item = {};
        list[i] = item;
      }
      item.size = cellSize + margin*2;
    }

    var pos = margin;
    var start = 0;
    for (i = 0; i < count; i++) {
      item = list[i];
      item.pos = pos;
      pos += item.size;
      start = gutterSize;
      item.size -= start;
    }
  };

  this.getGameState = function() {
    return localStorage.getItem('game_state');
  };

  this.setGameState = function(value) {
    localStorage.setItem('game_state', value);
  };

  this.saveGame = function() {
    if(this.getGameState() !== 'ongoing') {
      return;
    }

    var cells = [];
    this.eachCell(function(row, col, cell) {
      if(cell) {
        cells.push({row: row, col: col, value: cell.getValue()});
      }
    });
    localStorage.setItem('cells', JSON.stringify(cells));
    this.score.save();
  };

  this.loadGame = function() {
    var cells = localStorage.getItem('cells');
    cells  = cells ? JSON.parse(cells) : [];
    var length = cells.length;
    if(length > 0) {
      for(var i=0; i<length; i++) {
        var cell = cells[i];
        this.addCell(cell.row, cell.col, cell.value);
      }
      this.setGameState('ongoing');
      this.score.load();
    } else {
      // incorrect data from local storage
      this.setGameState('over');
      this.initCells();
    }
  };

  this.gameOver = function() {
    var score = this.score;
    this.emit('Over');
    this.setGameState('over');
    this.overlay.show();
    PlayGame.leaderboard('score', score.score);
    PlayGame.leaderboard('tile', score.highestTile);
  };

  this.initCells = function() {
    console.log('----game state is:', this.getGameState());
    if(this.getGameState() === 'ongoing') {
      this.loadGame();
    } else {
      this.reset();
      for(var i=0; i< startCells; i++) {
        this.addRandomCell();
      }
      this.setGameState('ongoing');
    }
  };

  this.addRandomCell = function() {
    var value = Math.random() < 0.9 ? 2 : 4;
      pos = this.randomAvailableCell();
    if(this.isCellsAvailable()) {
      this.addCell(pos.row, pos.col, value);
    }
  };

  this.addCell = function(row, col, val) {
    var cell = this.cellPool.obtainView();
      cell.updateOpts({
        superview: this,
        row: row,
        col: col,
        scale: 0.1,
        visible: true
      });
    cell.setValue(val);

    this.cells[row][col] = cell;
    this.reflow();
    var anim = animate(cell);
    anim.now({
      scale: 0.1
    }, 0).
    then({
      scale: 1
    }, 100);
    console.log('addcell', [row, col], val);
  };

  this.removeCell = function(cell) {
    var row = cell._opts.row,
      col = cell._opts.col;
    if(this.cells[row][col] === cell) {
      this.cells[row][col] = null;
    }
    console.log('removing', row, col);
    var anim = animate(cell);
    anim.now({
      scale: 1
    }, 0).
    then({
      scale: 1.2
    }, 100, animate.linear).
    then({
      scale: 1
    }, 100, animate.linear).
    then(bind(this, function() {
      this.cellPool.releaseView(cell);
    }));
  };

  this.mergeCells = function(cell1, cell2) {
    var newVal = cell1.getValue() + cell2.getValue();
    cell1.setValue(newVal);
    cell2.setValue(newVal);
    PlayGame.achievement(newVal);
    this.removeCell(cell2);
    this.score.update(newVal);
    this.emit('updateScore', newVal);
  };

  this.moveCells = function(direction, cb) {
    var mergedCells = [],
      vector = Utils.getVector(direction),
      traversals = this.buildTraversals(vector),
      moveMade = false,
      finish = Utils.finish(traversals.row.length * traversals.col.length, bind(this, function() {
        if(!(this.isCellsAvailable() || this.isMovesAvailable())) {
          this.gameOver();
        }
        cb.fire(moveMade);
      }));

    traversals.col.forEach(bind(this, function (x) {
      traversals.row.forEach(bind(this, function (y) {
        var cell = this.getCell(y, x),
          callback = new Callback();
        callback.run(finish);

        if (cell) {
          var pos = this.findFarthestPosition({ row: y, col: x }, vector),
            next = pos.next ? this.getCell(pos.next.row, pos.next.col) : null;

          if (next && next.getValue() === cell.getValue() && mergedCells.indexOf(next) === -1) {
            console.log('merge cells', [y,x], cell.getValue(), pos.next, next.getValue());
            moveMade = true;
            this.moveCell(cell, pos.next, callback);
            mergedCells.push(cell);
            this.mergeCells(cell, next);
          } else if(this.moveCell(cell, pos.farthest, callback)) {
            moveMade = true;
          }
        } else {
          callback.fire();
        }
      }));
    }));
  };

  this.moveCell = function(cell, farthest, cb) {
    var anim = animate(cell, 'animationGroup'),
      opts = cell._opts,
      col = farthest.col,
      row = farthest.row,
      prevCol = opts.col,
      prevRow = opts.row;
      target = this.getCellPos(row, col);

    this.cells[prevRow][prevCol] = null;
    this.cells[row][col] = cell;
    console.log('moving', prevRow, prevCol, '=>', row, col);
    if(col !== opts.col || row !== opts.row) {
      anim.then({
          x: target.x,
          y: target.y
        }, 100, animate.linear).
        then(function(){
          cell.setProperty('col', col);
          cell.setProperty('row', row);
          cb && cb.fire();
        }, 0);
        return true;
    } else {
      cb && cb.fire();
      return false;
    }
  };

  this.getCell = function (row, col) {
    var rows = this.getRows(),
      cols = this.getCols();
    if(row >= rows || row < 0 || col < 0 || col >= cols) {
      return false;
    }
    return this.cells[row][col];
  };

  this.eachCell = function(callback) {
    var cells = this.cells;
    for (var row = 0; row < this.getCols(); row++) {
      for (var col = 0; col < this.getRows(); col++) {
        callback(row, col, cells[row][col]);
      }
    }
  };

  this.availableCells = function() {
    var cells = [];

    this.eachCell(function(row, col, cell) {
      if(!cell) {
        cells.push({row: row, col: col});
      }
    });
    return cells;
  };

  this.randomAvailableCell = function () {
    var cells = this.availableCells();

    if (cells.length) {
      return cells[Math.floor(Math.random() * cells.length)];
    }
  };

  this.isCellsAvailable = function () {
    return !!this.availableCells().length;
  };

  this.isCellAvailable = function (row, col) {
    return !this.getCell(row, col);
  };

  this.withinBounds = function(row, col) {
    return col >= 0 && col < this.getCols() &&
      row >= 0 && row < this.getRows();
  };

  this.buildTraversals = function(vector) {
    var trav = {
        col: [],
        row: []
      },
      pos = 0;

    for (pos = 0; pos < this.getCols(); pos++) {
      trav.col.push(pos);
    }
    for (pos = 0; pos < this.getCols(); pos++) {
      trav.row.push(pos);
    }

    if (vector.col === 1) {
      trav.col = trav.col.reverse();
    }
    if(vector.row === 1) {
      trav.row = trav.row.reverse();
    }

    return trav;
  };

  this.findFarthestPosition = function (cell, vector) {
    var previous, ret = {};

    do {
      previous = cell;
      cell = {
        col: previous.col + vector.col,
        row: previous.row + vector.row
      };
    } while (this.withinBounds(cell.row, cell.col) &&
             this.isCellAvailable(cell.row, cell.col));

    return {
      farthest: previous,
      next: this.withinBounds(cell.row, cell.col) ? cell : null
    };
  };

  this.getCellSize = function(row, col) {
    return {
        width: this._colInfo[col].size,
        height: this._rowInfo[row].size
      };
  };

  this.getCellPos = function(row, col) {
    var opts = this._opts,
      marginH = (row===0 ? opts.horizontalMargin : opts.horizontalMargin/2),
      marginV = (col===0 ? opts.verticalMargin: opts.verticalMargin/2);

    return {
      x: this._colInfo[col].pos + marginH,
      y: this._rowInfo[row].pos + marginV
    };
  };

  this.isMovesAvailable = function () {
    var flag = false,
      directions = ['left', 'right', 'up', 'down'];

    this.eachCell(bind(this, function(row, col, cell) {
      if(cell) {
        directions.forEach(bind(this, function(direction) {
          var vector = Utils.getVector(direction),
            other = this.getCell(row + vector.row, col + vector.col);

          if (other && other.getValue() === cell.getValue()) {
            flag = true;
          }
        }));
      }
    }));
    console.log('isMovesAvailable', flag);
    return flag;
  };

  this.reset = function() {
    var cell = this.cells;
    for (var x = 0; x < this.getRows(); x++) {
      for (var y = 0; y < this.getCols(); y++) {
        cell[x][y] = null;
      }
    }
    this.overlay.hide();
    this.cellPool.releaseAllViews();
    this.score.reset();
  };

  this.initOverlay = function(size) {
    var bg = new View({
      superview: this,
      inLayout: false,
      layout: 'linear',
      direction: 'vertical',
      justifyContent: 'center',
      visible: false,
      backgroundColor: Utils.colors.grid,
      zIndex: 2,
      opacity: 0.8,
      width: size,
      height: size
    });

    var img = new ImageView({
      superview: bg,
      width: 400,
      height: 400,
      image: 'resources/images/replay.png',
      x: 0,
      y: 0,
      centerX: true
    });

    var title = new TextView({
      superview: img,
      layout: 'box',
      centerX: true,
      centerY: true,
      width: 200,
      height: 50,
      offsetY: -10,
      inLayout: false,
      text: 'Game Over!',
      color: Utils.colors.text_bright,
      fontFamily: Utils.fonts.text
    });

    bg.on('InputOut', bind(this, function() {
      this.emit('Restart');
    }));

    return {
      setTitle: function(msg) {
        title.setText(msg);
      },
      show: function() {
        bg.style.visible = true;
      },
      hide: function() {
        bg.style.visible = false;
      }
    };
  };
});
